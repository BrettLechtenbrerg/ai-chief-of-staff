/**
 * campaign_send_message — send an SMS or Email to a GHL contact, with a
 * dry-run default so the agent always previews before anything actually sends.
 *
 * Safety: dryRun defaults to TRUE. The tool only dispatches a real send when
 * the caller explicitly passes dryRun:false (which the agent should do only
 * after an explicit human approval, consistent with the propose/approve posture
 * in src/config/system-guidelines.ts). All calls route through the sanctioned
 * MCP layer — never raw shell+curl.
 */

import { resolveGhlServer, callGhl } from './ghl-shared';

export type CampaignMessageChannel = 'SMS' | 'Email';

export interface CampaignSendMessageInput {
  contactId: string;
  channel: CampaignMessageChannel;
  message: string;
  subject?: string;
  fromNumber?: string;
  dryRun?: boolean;
}

export interface CampaignSendMessageResult {
  ok: boolean;
  status: 'sent' | 'dry_run' | 'not_connected' | 'invalid_input' | 'error';
  message?: string;
  preview?: { contactId: string; channel: CampaignMessageChannel; subject?: string; body: string };
}

export async function runCampaignSendMessage(
  input: CampaignSendMessageInput,
): Promise<CampaignSendMessageResult> {
  const contactId = input.contactId?.trim();
  const body = input.message?.trim();
  const channel = input.channel;
  if (!contactId || !body) {
    return { ok: false, status: 'invalid_input', message: 'contactId and message are required.' };
  }
  if (channel !== 'SMS' && channel !== 'Email') {
    return { ok: false, status: 'invalid_input', message: 'channel must be "SMS" or "Email".' };
  }
  if (channel === 'Email' && !input.subject?.trim()) {
    return { ok: false, status: 'invalid_input', message: 'Email messages require a subject.' };
  }

  // Default to dry-run: only a literal false triggers a real send.
  const dryRun = input.dryRun !== false;
  const preview = {
    contactId,
    channel,
    ...(input.subject ? { subject: input.subject.trim() } : {}),
    body,
  };

  if (dryRun) {
    return {
      ok: true,
      status: 'dry_run',
      preview,
      message:
        'DRY RUN — nothing was sent. Show this preview to Brett and, only after he approves, call again with dryRun:false.',
    };
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
  if (!tools.has('send_message')) {
    return { ok: false, status: 'error', message: 'This GHL server has no send_message tool.' };
  }

  try {
    const args: Record<string, unknown> = { contact_id: contactId, type: channel, message: body };
    if (channel === 'Email' && input.subject) args.subject = input.subject.trim();
    if (channel === 'SMS' && input.fromNumber) args.from_number = input.fromNumber.trim();
    await callGhl(serverName, 'send_message', args);
    return {
      ok: true,
      status: 'sent',
      preview,
      message: `Sent ${channel} to contact ${contactId}.`,
    };
  } catch (err) {
    return { ok: false, status: 'error', message: `send_message failed: ${(err as Error).message}` };
  }
}

export function getCampaignSendMessageToolDefinition() {
  return {
    name: 'campaign_send_message',
    description:
      'Send an SMS or Email to a GoHighLevel contact. SAFETY: defaults to a DRY RUN — it returns a preview and sends nothing unless you pass dryRun:false, which you should only do AFTER Brett explicitly approves the preview. Email requires a subject. Returns JSON with the preview and whether it was a dry run or an actual send. Routes only through the sanctioned GHL layer. If GHL isn\'t connected it returns ok:false with a status/message to relay.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID to message (required).' },
        channel: { type: 'string', enum: ['SMS', 'Email'], description: 'Channel to send on (required).' },
        message: { type: 'string', description: 'Plain-text message body (required).' },
        subject: { type: 'string', description: 'Email subject line (required for Email).' },
        fromNumber: { type: 'string', description: 'Sender phone in E.164 for SMS (optional).' },
        dryRun: {
          type: 'boolean',
          description: 'Defaults to true (preview only). Pass false to actually send — only after explicit human approval.',
        },
      },
      required: ['contactId', 'channel', 'message'],
    },
  };
}

export async function handleCampaignSendMessageTool(input: unknown): Promise<string> {
  const result = await runCampaignSendMessage((input as CampaignSendMessageInput) ?? {});
  return JSON.stringify(result);
}
