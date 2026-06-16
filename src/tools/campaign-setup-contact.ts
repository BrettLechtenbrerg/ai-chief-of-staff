/**
 * campaign_setup_contact — idempotent "make sure this person exists in GHL with
 * the right tags" building block for campaign operations.
 *
 * Looks the contact up by email (then phone), creates them if missing or updates
 * them if present, and applies the requested tags. Returns JSON describing
 * whether the contact was created vs. updated and which tags are now on them.
 *
 * Division of labour mirrors the other campaign_* tools: this does the
 * mechanical upsert through the sanctioned MCP layer; the agent narrates the
 * result. It NEVER deletes and never touches anyone but the addressed contact.
 */

import {
  resolveGhlServer,
  callGhl,
  extractContactId,
  extractList,
} from './ghl-shared';

export interface CampaignSetupContactInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
  source?: string;
}

export interface CampaignSetupContactResult {
  ok: boolean;
  status: 'created' | 'updated' | 'not_connected' | 'invalid_input' | 'error';
  message?: string;
  contactId?: string;
  appliedTags?: string[];
}

/** Find an existing contact id by email, falling back to phone. */
async function findExistingContactId(
  serverName: string,
  tools: Set<string>,
  email?: string,
  phone?: string,
): Promise<string | null> {
  if (!tools.has('search_contacts')) return null;
  for (const args of [email ? { email } : null, phone ? { phone } : null]) {
    if (!args) continue;
    try {
      const { json } = await callGhl(serverName, 'search_contacts', args);
      const list = extractList(json);
      if (list.length > 0) {
        const id = extractContactId(list[0]) ?? (list[0].id != null ? String(list[0].id) : null);
        if (id) return id;
      }
    } catch {
      // Search failure shouldn't block creation — treat as "not found".
    }
  }
  return null;
}

export async function runCampaignSetupContact(
  input: CampaignSetupContactInput,
): Promise<CampaignSetupContactResult> {
  const email = input.email?.trim();
  const phone = input.phone?.trim();
  if (!email && !phone) {
    return {
      ok: false,
      status: 'invalid_input',
      message: 'Provide at least an email or a phone number to identify the contact.',
    };
  }

  const ghl = resolveGhlServer();
  if (!ghl) {
    return {
      ok: false,
      status: 'not_connected',
      message:
        'GoHighLevel is not connected. Connect GHL in Settings → Connections, then re-run.',
    };
  }
  const { serverName, tools } = ghl;
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

  try {
    const existingId = await findExistingContactId(serverName, tools, email, phone);

    if (existingId) {
      // Update the known fields, then add tags additively (update_contact
      // REPLACES tags, so we use add_contact_tags to avoid clobbering).
      const updateArgs: Record<string, unknown> = { contact_id: existingId };
      if (input.firstName) updateArgs.first_name = input.firstName;
      if (input.lastName) updateArgs.last_name = input.lastName;
      if (email) updateArgs.email = email;
      if (phone) updateArgs.phone = phone;
      if (Object.keys(updateArgs).length > 1 && tools.has('update_contact')) {
        await callGhl(serverName, 'update_contact', updateArgs);
      }
      if (tags.length > 0 && tools.has('add_contact_tags')) {
        await callGhl(serverName, 'add_contact_tags', { contact_id: existingId, tags });
      }
      return {
        ok: true,
        status: 'updated',
        contactId: existingId,
        appliedTags: tags,
        message: `Updated existing contact ${existingId}.`,
      };
    }

    // Create new.
    const createArgs: Record<string, unknown> = {
      first_name: input.firstName || 'Unknown',
    };
    if (input.lastName) createArgs.last_name = input.lastName;
    if (email) createArgs.email = email;
    if (phone) createArgs.phone = phone;
    if (tags.length > 0) createArgs.tags = tags;
    if (input.source) createArgs.source = input.source;

    const { json } = await callGhl(serverName, 'create_contact', createArgs);
    const contactId = extractContactId(json);
    if (!contactId) {
      return {
        ok: false,
        status: 'error',
        message:
          'create_contact did not return a contact id — the GHL token or location may be misconfigured.',
      };
    }
    return {
      ok: true,
      status: 'created',
      contactId,
      appliedTags: tags,
      message: `Created new contact ${contactId}.`,
    };
  } catch (err) {
    return { ok: false, status: 'error', message: `GHL call failed: ${(err as Error).message}` };
  }
}

export function getCampaignSetupContactToolDefinition() {
  return {
    name: 'campaign_setup_contact',
    description:
      'Idempotently set up a GoHighLevel contact for a campaign: find them by email (or phone), create if missing or update if present, and apply tags additively (existing tags are preserved). Returns JSON with whether the contact was created vs. updated and the applied tags. Use this as the first step of campaign setup. It NEVER deletes contacts. If GHL is not connected it returns ok:false with a status/message to relay to Brett.',
    input_schema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Contact email — primary identifier for the upsert.' },
        phone: { type: 'string', description: 'Contact phone in E.164 (e.g. +14155552671) — fallback identifier.' },
        firstName: { type: 'string', description: 'Contact first name.' },
        lastName: { type: 'string', description: 'Contact last name.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply (added, not replaced). E.g. the campaign entry tag.',
        },
        source: { type: 'string', description: 'Lead source for new contacts (e.g. "website", "referral").' },
      },
      required: [],
    },
  };
}

export async function handleCampaignSetupContactTool(input: unknown): Promise<string> {
  const result = await runCampaignSetupContact((input as CampaignSetupContactInput) ?? {});
  return JSON.stringify(result);
}
