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

import { resolveGhlServer, callGhl, extractContactId, contactHasTag } from './ghl-shared';

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
