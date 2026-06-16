/**
 * campaign_enroll — enroll a GHL contact into a pre-built workflow or legacy
 * drip campaign, resolving a human-friendly name to its id.
 *
 * Workflows and drip campaigns must already exist in the GHL UI (there is no
 * create-workflow API). This tool only enrolls; it resolves the name via
 * list_workflows / list_drip_campaigns, then calls add_contact_to_workflow /
 * add_contact_to_campaign. Returns JSON describing what it enrolled into.
 */

import { resolveGhlServer, callGhl, extractList, resolveNameToId } from './ghl-shared';

export interface CampaignEnrollInput {
  contactId: string;
  /** Either a workflow OR a drip campaign target (by id or name). */
  workflowId?: string;
  workflowName?: string;
  campaignId?: string;
  campaignName?: string;
}

export interface CampaignEnrollResult {
  ok: boolean;
  status:
    | 'enrolled'
    | 'not_connected'
    | 'invalid_input'
    | 'not_found'
    | 'ambiguous'
    | 'error';
  message?: string;
  target?: { kind: 'workflow' | 'drip_campaign'; id: string };
}

export async function runCampaignEnroll(
  input: CampaignEnrollInput,
): Promise<CampaignEnrollResult> {
  const contactId = input.contactId?.trim();
  if (!contactId) {
    return { ok: false, status: 'invalid_input', message: 'contactId is required.' };
  }
  const wantsWorkflow = Boolean(input.workflowId || input.workflowName);
  const wantsCampaign = Boolean(input.campaignId || input.campaignName);
  if (wantsWorkflow === wantsCampaign) {
    return {
      ok: false,
      status: 'invalid_input',
      message:
        'Specify exactly one target: a workflow (workflowId/workflowName) OR a drip campaign (campaignId/campaignName).',
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

  try {
    if (wantsWorkflow) {
      let id = input.workflowId?.trim() || null;
      if (!id && input.workflowName) {
        if (!tools.has('list_workflows')) {
          return { ok: false, status: 'error', message: 'This GHL server cannot list workflows to resolve the name.' };
        }
        const { json } = await callGhl(serverName, 'list_workflows', {});
        id = resolveNameToId(extractList(json), input.workflowName);
        if (!id) {
          return {
            ok: false,
            status: 'not_found',
            message: `No single workflow matched "${input.workflowName}". Check the name in GHL, or pass workflowId.`,
          };
        }
      }
      if (!tools.has('add_contact_to_workflow')) {
        return { ok: false, status: 'error', message: 'This GHL server has no add_contact_to_workflow tool.' };
      }
      await callGhl(serverName, 'add_contact_to_workflow', { contact_id: contactId, workflow_id: id });
      return {
        ok: true,
        status: 'enrolled',
        target: { kind: 'workflow', id: id! },
        message: `Enrolled contact ${contactId} into workflow ${id}.`,
      };
    }

    // Drip campaign path.
    let id = input.campaignId?.trim() || null;
    if (!id && input.campaignName) {
      if (!tools.has('list_drip_campaigns')) {
        return { ok: false, status: 'error', message: 'This GHL server cannot list drip campaigns to resolve the name.' };
      }
      const { json } = await callGhl(serverName, 'list_drip_campaigns', {});
      id = resolveNameToId(extractList(json), input.campaignName);
      if (!id) {
        return {
          ok: false,
          status: 'not_found',
          message: `No single drip campaign matched "${input.campaignName}". Check the name in GHL, or pass campaignId.`,
        };
      }
    }
    if (!tools.has('add_contact_to_campaign')) {
      return { ok: false, status: 'error', message: 'This GHL server has no add_contact_to_campaign tool.' };
    }
    await callGhl(serverName, 'add_contact_to_campaign', { contact_id: contactId, campaign_id: id });
    return {
      ok: true,
      status: 'enrolled',
      target: { kind: 'drip_campaign', id: id! },
      message: `Enrolled contact ${contactId} into drip campaign ${id}.`,
    };
  } catch (err) {
    return { ok: false, status: 'error', message: `GHL call failed: ${(err as Error).message}` };
  }
}

export function getCampaignEnrollToolDefinition() {
  return {
    name: 'campaign_enroll',
    description:
      'Enroll a GoHighLevel contact into a pre-built workflow OR a legacy drip campaign. Workflows/campaigns must already exist in the GHL UI (no create-workflow API exists). You can pass an id directly, or a name which is resolved via list_workflows / list_drip_campaigns. Specify exactly one target. Returns JSON with the resolved target id. If the name is ambiguous or missing it returns ok:false with a status/message to relay.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID to enroll (required).' },
        workflowId: { type: 'string', description: 'Workflow ID to enroll into.' },
        workflowName: { type: 'string', description: 'Workflow name to resolve to an id (alternative to workflowId).' },
        campaignId: { type: 'string', description: 'Drip campaign ID to enroll into.' },
        campaignName: { type: 'string', description: 'Drip campaign name to resolve to an id (alternative to campaignId).' },
      },
      required: ['contactId'],
    },
  };
}

export async function handleCampaignEnrollTool(input: unknown): Promise<string> {
  const result = await runCampaignEnroll((input as CampaignEnrollInput) ?? {});
  return JSON.stringify(result);
}
