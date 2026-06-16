/**
 * campaign_status — read-only snapshot of a contact's campaign-relevant state in
 * GoHighLevel: current tags, recent conversations, and any opportunities.
 *
 * Honest scope: GHL has NO API to read how many contacts are enrolled in a
 * workflow, so this tool does NOT claim an "enrolled count". It reports what is
 * actually readable — tags (which usually mark campaign entry), recent
 * conversation activity, and opportunity stage — so the agent can tell Brett
 * where a contact stands. Strictly read-only; never writes.
 */

import {
  resolveGhlServer,
  callGhl,
  extractContact,
  extractList,
} from './ghl-shared';

export interface CampaignStatusInput {
  contactId: string;
}

export interface CampaignStatusResult {
  ok: boolean;
  status: 'ok' | 'not_connected' | 'invalid_input' | 'not_found' | 'error';
  message?: string;
  contactId?: string;
  tags?: string[];
  conversationCount?: number;
  latestConversationStatus?: string | null;
  opportunities?: Array<{ id: string | null; name: string | null; stage: string | null; statusValue: string | null }>;
}

export async function runCampaignStatus(
  input: CampaignStatusInput,
): Promise<CampaignStatusResult> {
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

  try {
    // Contact + tags.
    const { json: contactJson } = await callGhl(serverName, 'get_contact', { contact_id: contactId });
    const contact = extractContact(contactJson);
    if (!contact) {
      return { ok: false, status: 'not_found', message: `No contact found for id ${contactId}.` };
    }
    const tags = Array.isArray(contact.tags) ? contact.tags.map((t) => String(t)) : [];

    // Conversations (read-only). Best-effort — absence is not an error.
    let conversationCount: number | undefined;
    let latestConversationStatus: string | null = null;
    if (tools.has('search_conversations')) {
      try {
        const { json } = await callGhl(serverName, 'search_conversations', { contact_id: contactId });
        const list = extractList(json);
        conversationCount = list.length;
        if (list.length > 0) {
          const s = list[0].status;
          latestConversationStatus = s != null ? String(s) : null;
        }
      } catch {
        // leave undefined
      }
    }

    // Opportunities (read-only).
    const opportunities: CampaignStatusResult['opportunities'] = [];
    if (tools.has('search_opportunities')) {
      try {
        const { json } = await callGhl(serverName, 'search_opportunities', { contact_id: contactId });
        for (const o of extractList(json)) {
          opportunities.push({
            id: o.id != null ? String(o.id) : null,
            name: o.name != null ? String(o.name) : null,
            stage: (o.pipelineStageId ?? o.stage ?? null) as string | null,
            statusValue: o.status != null ? String(o.status) : null,
          });
        }
      } catch {
        // leave empty
      }
    }

    return {
      ok: true,
      status: 'ok',
      contactId,
      tags,
      conversationCount,
      latestConversationStatus,
      opportunities,
    };
  } catch (err) {
    return { ok: false, status: 'error', message: `GHL call failed: ${(err as Error).message}` };
  }
}

export function getCampaignStatusToolDefinition() {
  return {
    name: 'campaign_status',
    description:
      "Read-only snapshot of one GoHighLevel contact's campaign-relevant state: current tags (which usually mark campaign entry), recent conversation activity, and any opportunities with their stage. NOTE: GHL has no API to read workflow-enrollment counts, so this does not report an 'enrolled count'. Returns JSON for the agent to summarize. Never writes. If GHL isn't connected it returns ok:false with a status/message to relay.",
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID to summarize (required).' },
      },
      required: ['contactId'],
    },
  };
}

export async function handleCampaignStatusTool(input: unknown): Promise<string> {
  const result = await runCampaignStatus((input as CampaignStatusInput) ?? {});
  return JSON.stringify(result);
}
