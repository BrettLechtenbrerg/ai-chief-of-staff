/**
 * campaign_verify — assert that a REAL contact is wired into a campaign the way
 * you expect, without creating or modifying anything.
 *
 * This is the post-launch confidence check (the smoke test's read-only sibling).
 * Given a contact id, it confirms the expected tag(s) are present and that there
 * is recent conversation activity if requested. Strictly read-only.
 *
 * Honest scope: GHL exposes no API to read workflow enrollment, so this tool
 * cannot assert "is enrolled in workflow X". It verifies what is readable —
 * tags and conversation activity — and says so plainly.
 */

import {
  resolveGhlServer,
  callGhl,
  extractContact,
  contactHasTag,
  extractList,
} from './ghl-shared';

export interface CampaignVerifyInput {
  contactId: string;
  expectedTags?: string[];
  expectConversation?: boolean;
}

interface CheckResult {
  check: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
}

export interface CampaignVerifyResult {
  ok: boolean;
  status: 'verified' | 'not_connected' | 'invalid_input' | 'not_found' | 'error';
  message?: string;
  contactId?: string;
  checks?: CheckResult[];
}

export async function runCampaignVerify(
  input: CampaignVerifyInput,
): Promise<CampaignVerifyResult> {
  const contactId = input.contactId?.trim();
  if (!contactId) {
    return { ok: false, status: 'invalid_input', message: 'contactId is required.' };
  }

  const ghl = resolveGhlServer();
  if (!ghl) {
    return {
      ok: false,
      status: 'not_connected',
      message: 'GoHighLevel is not connected. Connect GHL in Settings → Connections, then re-run.',
    };
  }
  const { serverName, tools } = ghl;
  const checks: CheckResult[] = [];

  try {
    const { json: contactJson } = await callGhl(serverName, 'get_contact', { contact_id: contactId });
    const contact = extractContact(contactJson);
    if (!contact) {
      return { ok: false, status: 'not_found', message: `No contact found for id ${contactId}.` };
    }

    // Tag assertions.
    const expectedTags = (input.expectedTags ?? []).map((t) => t.trim()).filter(Boolean);
    if (expectedTags.length > 0) {
      for (const tag of expectedTags) {
        const present = contactHasTag(contactJson, tag);
        checks.push({
          check: `tag:${tag}`,
          status: present ? 'pass' : 'fail',
          detail: present ? `Tag "${tag}" is present.` : `Tag "${tag}" is MISSING.`,
        });
      }
    } else {
      checks.push({
        check: 'tags',
        status: 'skipped',
        detail: 'No expectedTags provided — tag assertions skipped.',
      });
    }

    // Conversation activity assertion (optional).
    if (input.expectConversation) {
      if (tools.has('search_conversations')) {
        const { json } = await callGhl(serverName, 'search_conversations', { contact_id: contactId });
        const count = extractList(json).length;
        checks.push({
          check: 'conversation',
          status: count > 0 ? 'pass' : 'fail',
          detail: count > 0 ? `${count} conversation(s) found.` : 'No conversations found for this contact.',
        });
      } else {
        checks.push({
          check: 'conversation',
          status: 'skipped',
          detail: 'This GHL server has no search_conversations tool.',
        });
      }
    }

    const anyFail = checks.some((c) => c.status === 'fail');
    return {
      ok: !anyFail,
      status: 'verified',
      contactId,
      checks,
    };
  } catch (err) {
    return { ok: false, status: 'error', message: `GHL call failed: ${(err as Error).message}` };
  }
}

export function getCampaignVerifyToolDefinition() {
  return {
    name: 'campaign_verify',
    description:
      'Verify that a REAL GoHighLevel contact is wired into a campaign as expected — read-only, creates/modifies nothing. Given a contactId, confirms expected tags are present and (optionally) that the contact has conversation activity. NOTE: GHL has no API to read workflow enrollment, so this cannot assert workflow membership — only tags and conversations. Returns JSON with a per-check pass/fail breakdown for the agent to summarize. If GHL isn\'t connected it returns ok:false with a status/message to relay.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID to verify (required).' },
        expectedTags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags that should be present on the contact (e.g. the campaign entry tag).',
        },
        expectConversation: {
          type: 'boolean',
          description: 'If true, assert the contact has at least one conversation (e.g. a welcome message went out).',
        },
      },
      required: ['contactId'],
    },
  };
}

export async function handleCampaignVerifyTool(input: unknown): Promise<string> {
  const result = await runCampaignVerify((input as CampaignVerifyInput) ?? {});
  return JSON.stringify(result);
}
