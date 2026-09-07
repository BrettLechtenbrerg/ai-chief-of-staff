import type { PolicyAwareAgentTool } from '../agent/tool-policy.js';

// Exact bundled handlers, not server-provided annotations or naming heuristics.
const PROPOSAL_TOOLS: Record<string, { preview: string; types: readonly string[] }> = {
  'mcp__flo-gmail__gmail_execute': {
    preview: 'mcp__flo-gmail__gmail_preview',
    types: ['gmail.send', 'gmail.delete', 'gmail.empty_trash', 'gmail.modify_labels'],
  },
  'mcp__flo-calendar__calendar_execute': {
    preview: 'mcp__flo-calendar__calendar_preview',
    types: ['calendar.create', 'calendar.delete', 'calendar.recurring'],
  },
  'mcp__flo-docs__docs_execute': {
    preview: 'mcp__flo-docs__docs_preview',
    types: ['docs.create', 'drive.upload', 'drive.create_folder', 'drive.move_file',
      'docs.append_text', 'docs.replace_text', 'docs.delete_content', 'docs.move_content',
      'docs.insert_at_position', 'docs.apply_formatting'],
  },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Hash authority comes exclusively from the stored server snapshot. */
export function proposalApprovalPreparer(
  name: string,
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>
): PolicyAwareAgentTool['prepareApproval'] {
  if (!Object.hasOwn(PROPOSAL_TOOLS, name)) return undefined;
  const spec = PROPOSAL_TOOLS[name];
  return async (args, context) => {
    if (context.signal?.aborted) throw new Error('Canceled');
    if (!record(args)) throw new Error('Invalid arguments');
    const ids = args.proposal_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 ||
        ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) ||
        new Set(ids).size !== ids.length) throw new Error('Invalid proposal IDs');
    const raw = await callTool(spec.preview, { proposal_ids: [...ids] });
    if (context.signal?.aborted) throw new Error('Canceled');
    // Manager/client flatten successful text responses; errors are non-JSON text.
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 1024 * 1024) {
      throw new Error('Invalid preview size');
    }
    const snapshot: unknown = JSON.parse(raw);
    if (!record(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.proposals) ||
        snapshot.proposals.length !== ids.length) throw new Error('Invalid snapshot');
    const hashes: Record<string, string> = Object.create(null);
    for (const proposal of snapshot.proposals) {
      if (!record(proposal) || typeof proposal.id !== 'string' || !ids.includes(proposal.id) ||
          Object.hasOwn(hashes, proposal.id) || typeof proposal.type !== 'string' ||
          !spec.types.includes(proposal.type) || typeof proposal.payload_hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(proposal.payload_hash) || !record(proposal.preview) ||
          typeof proposal.risk !== 'string' || !Array.isArray(proposal.violations)) {
        throw new Error('Invalid proposal');
      }
      if (proposal.type === 'gmail.send' && proposal.preview.attachments !== undefined) {
        const attachments = proposal.preview.attachments;
        if (!Array.isArray(attachments) || attachments.some(attachment =>
          !record(attachment) || typeof attachment.filename !== 'string' ||
          !Number.isSafeInteger(attachment.size) || (attachment.size as number) < 0 ||
          typeof attachment.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(attachment.sha256) ||
          Object.hasOwn(attachment, 'content'))) throw new Error('Invalid attachment preview');
      }
      hashes[proposal.id] = proposal.payload_hash;
    }
    return {
      // Preserve all captured override flags; replace any model-supplied hashes.
      executeArgs: { ...args, proposal_ids: [...ids], expected_payload_hashes: hashes },
      preview: snapshot,
    };
  };
}
