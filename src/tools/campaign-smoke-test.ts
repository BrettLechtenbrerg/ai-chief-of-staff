/**
 * campaign_smoke_test — end-to-end "is my GHL campaign wiring actually working?"
 * check that the agent can run on demand.
 *
 * Division of labour (mirrors fetch_seo_data / write_daily_posting_packet):
 *   - THIS TOOL does the mechanical, untrustworthy-to-guess part: create a
 *     clearly-labelled synthetic contact in GoHighLevel, apply a tag, optionally
 *     enroll it into a pre-built workflow, poll GHL to confirm each step landed,
 *     then DELETE the synthetic contact so nothing pollutes real nurture. It
 *     returns compact JSON describing exactly what passed/failed.
 *   - THE AGENT does the judgment part: read that JSON and tell Brett in plain
 *     English what's wired correctly and what needs attention.
 *
 * Safety:
 *   - Every GHL call goes through the sanctioned MCP layer (getMCPManager().
 *     callTool) — never raw shell+curl (see src/config/system-guidelines.ts).
 *   - The synthetic contact is tagged `acos-smoke-test` and uses a unique,
 *     obviously-fake email so it can never be confused with a real lead.
 *   - Cleanup runs in a finally block: even if an assertion throws, we still
 *     attempt to delete the test contact (needs the `delete_contact` tool added
 *     to vendor/ghl-mcp-node).
 *
 * Graceful degradation (never throws out of the tool):
 *   - GHL not connected            → ok:false, status:'not_connected'.
 *   - delete_contact unavailable   → still report results, flag cleanup as
 *                                     skipped so Brett can prune manually.
 *   - workflow id omitted          → enrollment step reported as 'skipped'.
 */

import { getMCPManager } from '../mcp/manager';
import type { MCPToolDescriptor } from '../mcp/types';

/** Tag applied to every synthetic contact so they're trivially identifiable. */
const SMOKE_TAG = 'acos-smoke-test';

/** GHL tool names this smoke test relies on (unprefixed, as the server exposes them). */
const REQUIRED_TOOLS = ['create_contact', 'get_contact', 'add_contact_tags'] as const;

export interface CampaignSmokeTestInput {
  /** Optional GHL workflow ID to enroll the test contact into (built once in the GHL UI). */
  workflowId?: string;
  /** Optional extra tag to apply alongside the smoke-test tag, to mimic a real campaign entry tag. */
  campaignTag?: string;
}

interface StepResult {
  step: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
}

export interface CampaignSmokeTestResult {
  ok: boolean;
  status:
    | 'completed'
    | 'not_connected'
    | 'missing_tools'
    | 'create_failed';
  message?: string;
  contactId?: string;
  testEmail?: string;
  steps?: StepResult[];
  cleanedUp?: boolean;
}

/**
 * Find the ready GHL MCP server by looking for one that exposes `create_contact`.
 * The server may be registered as `ghl-mcp` (bundled) or `flo-ghl` / `flo-ghl-brett`
 * (Brett's hand-built entries), so we resolve by capability rather than by name.
 */
function resolveGhlServer(): { serverName: string; tools: Set<string> } | null {
  const all: MCPToolDescriptor[] = getMCPManager().getAllTools();
  const byServer = new Map<string, Set<string>>();
  for (const t of all) {
    if (!byServer.has(t.serverName)) byServer.set(t.serverName, new Set());
    byServer.get(t.serverName)!.add(t.toolName);
  }
  for (const [serverName, tools] of byServer) {
    if (tools.has('create_contact') && tools.has('get_contact')) {
      return { serverName, tools };
    }
  }
  return null;
}

/** Call a GHL tool through the sanctioned MCP layer and parse its JSON reply. */
async function callGhl(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ raw: string; json: unknown }> {
  const agentToolName = `mcp__${serverName}__${toolName}`;
  const raw = await getMCPManager().callTool(agentToolName, args);
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some tools return plain text; keep raw for the report.
  }
  return { raw, json };
}

/** Dig a contact id out of GHL's various response shapes. */
function extractContactId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.id === 'string') return obj.id;
  const contact = obj.contact as Record<string, unknown> | undefined;
  if (contact && typeof contact.id === 'string') return contact.id;
  return null;
}

/** True if the fetched contact carries the given tag (case-insensitive). */
function contactHasTag(json: unknown, tag: string): boolean {
  if (!json || typeof json !== 'object') return false;
  const obj = json as Record<string, unknown>;
  const contact = (obj.contact as Record<string, unknown>) ?? obj;
  const tags = contact.tags;
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => String(t).toLowerCase() === tag.toLowerCase());
}

export async function runCampaignSmokeTest(
  input: CampaignSmokeTestInput,
): Promise<CampaignSmokeTestResult> {
  const ghl = resolveGhlServer();
  if (!ghl) {
    return {
      ok: false,
      status: 'not_connected',
      message:
        'GoHighLevel is not connected (no ready MCP server exposes create_contact). ' +
        'Connect GHL in Settings → Connections, then re-run the smoke test.',
    };
  }

  const missing = REQUIRED_TOOLS.filter((t) => !ghl.tools.has(t));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 'missing_tools',
      message: `The connected GHL server is missing required tools: ${missing.join(', ')}.`,
    };
  }

  const { serverName, tools } = ghl;
  const steps: StepResult[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const testEmail = `acos-smoke+${stamp}@example.com`;
  const extraTag = input.campaignTag?.trim();
  let contactId: string | null = null;
  let cleanedUp = false;

  try {
    // 1. CREATE the synthetic contact (tagged so it's unmistakably a test).
    const createTags = extraTag ? [SMOKE_TAG, extraTag] : [SMOKE_TAG];
    try {
      const { json } = await callGhl(serverName, 'create_contact', {
        first_name: 'ACOS',
        last_name: 'SmokeTest',
        email: testEmail,
        tags: createTags,
        source: 'acos-smoke-test',
      });
      contactId = extractContactId(json);
      if (!contactId) {
        return {
          ok: false,
          status: 'create_failed',
          testEmail,
          message:
            'create_contact did not return a contact id. The GHL token or location may be misconfigured.',
        };
      }
      steps.push({
        step: 'create_contact',
        status: 'pass',
        detail: `Created test contact ${contactId} (${testEmail}).`,
      });
    } catch (err) {
      return {
        ok: false,
        status: 'create_failed',
        testEmail,
        message: `create_contact threw: ${(err as Error).message}`,
      };
    }

    // 2. VERIFY the tag landed (read back the contact).
    try {
      const { json } = await callGhl(serverName, 'get_contact', { contact_id: contactId });
      const tagged = contactHasTag(json, SMOKE_TAG);
      steps.push({
        step: 'verify_tag',
        status: tagged ? 'pass' : 'fail',
        detail: tagged
          ? `Tag "${SMOKE_TAG}" is present on the contact.`
          : `Tag "${SMOKE_TAG}" was NOT found on the read-back contact — tagging may be broken.`,
      });
    } catch (err) {
      steps.push({
        step: 'verify_tag',
        status: 'fail',
        detail: `get_contact threw while verifying the tag: ${(err as Error).message}`,
      });
    }

    // 3. ENROLL into a pre-built workflow (optional — needs a workflowId).
    if (input.workflowId && tools.has('add_contact_to_workflow')) {
      try {
        await callGhl(serverName, 'add_contact_to_workflow', {
          contact_id: contactId,
          workflow_id: input.workflowId,
        });
        steps.push({
          step: 'enroll_workflow',
          status: 'pass',
          detail: `Enrolled the test contact into workflow ${input.workflowId}.`,
        });
      } catch (err) {
        steps.push({
          step: 'enroll_workflow',
          status: 'fail',
          detail: `add_contact_to_workflow threw: ${(err as Error).message}`,
        });
      }
    } else {
      steps.push({
        step: 'enroll_workflow',
        status: 'skipped',
        detail: input.workflowId
          ? 'The connected GHL server has no add_contact_to_workflow tool.'
          : 'No workflowId provided — enrollment was skipped (build a workflow in the GHL UI and pass its id to test this).',
      });
    }
  } finally {
    // 4. CLEANUP — always attempt to delete the synthetic contact.
    if (contactId) {
      if (tools.has('delete_contact')) {
        try {
          await callGhl(serverName, 'delete_contact', { contact_id: contactId });
          cleanedUp = true;
          steps.push({
            step: 'cleanup',
            status: 'pass',
            detail: `Deleted test contact ${contactId}.`,
          });
        } catch (err) {
          steps.push({
            step: 'cleanup',
            status: 'fail',
            detail: `delete_contact threw — prune contact ${contactId} manually: ${(err as Error).message}`,
          });
        }
      } else {
        steps.push({
          step: 'cleanup',
          status: 'skipped',
          detail: `This GHL server has no delete_contact tool — manually delete contact ${contactId} (tagged "${SMOKE_TAG}").`,
        });
      }
    }
  }

  const anyFail = steps.some((s) => s.status === 'fail');
  return {
    ok: !anyFail,
    status: 'completed',
    contactId: contactId ?? undefined,
    testEmail,
    steps,
    cleanedUp,
  };
}

export function getCampaignSmokeTestToolDefinition() {
  return {
    name: 'campaign_smoke_test',
    description:
      'Run an end-to-end smoke test of your GoHighLevel campaign wiring. Creates a clearly-labelled synthetic test contact (tagged "acos-smoke-test", fake @example.com email), applies tags, optionally enrolls it into a pre-built GHL workflow, reads it back to confirm each step landed, then DELETES the test contact so nothing pollutes real nurture. Returns JSON with a per-step pass/fail breakdown. Use this when Brett asks to "test the campaign", "check the GHL wiring", or before going live. It NEVER touches real contacts. If GHL isn\'t connected it returns ok:false with a status/message to relay. After calling, summarize in plain English: what passed, what failed, and any manual cleanup needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflowId: {
          type: 'string',
          description:
            'Optional GHL workflow ID to enroll the test contact into. Workflows must be built in the GHL UI first (there is no create-workflow API). Omit to skip the enrollment check.',
        },
        campaignTag: {
          type: 'string',
          description:
            'Optional extra tag to apply alongside the smoke-test tag, to mimic the entry tag a real campaign uses.',
        },
      },
      required: [],
    },
  };
}

export async function handleCampaignSmokeTestTool(input: unknown): Promise<string> {
  const result = await runCampaignSmokeTest((input as CampaignSmokeTestInput) ?? {});
  return JSON.stringify(result);
}
