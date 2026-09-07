import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@kenkaiiii/gg-agent';
import { getMCPManager } from '../../src/mcp/manager.js';
import { buildMCPAgentTools } from '../../src/mcp/proxy.js';
import { guardToolWithApproval, type PolicyAwareAgentTool } from '../../src/agent/tool-policy.js';
import { ApprovalManager } from '../../src/security/approval-manager.js';

const transport = vi.hoisted(() => ({ call: vi.fn(), missing: false }));
vi.mock('../../src/mcp/client', () => ({
  prefixToolName: (server: string, tool: string) => `mcp__${server}__${tool}`,
  MCPClient: class {
    status = 'ready';
    tools;
    constructor(public serverName: string) {
      const service = serverName.slice(4);
      this.tools = ['execute', ...(transport.missing ? [] : ['preview'])].map(action => ({
        serverName, toolName: `${service}_${action}`,
        agentToolName: `mcp__${serverName}__${service}_${action}`,
        description: '', inputSchema: { type: 'object' },
      }));
    }
    async start() {}
    async stop() {}
    callTool(name: string, args: unknown) { return transport.call(name, args); }
  },
}));

const hash = 'a'.repeat(64);
const proposal = () => ({ id: 'p1', type: 'gmail.send', payload_hash: hash,
  preview: { to: ['recipient@example.test'], subject: 'Review this', body: 'Exact stored body',
    attachments: [{ filename: 'report.pdf', size: 123, sha256: 'b'.repeat(64) }] },
  risk: 'high', violations: ['external recipient'] });
const snapshot = () => ({ version: 1, proposals: [proposal()] });
const context = (signal?: AbortSignal) => ({ signal } as ToolContext);
async function tool(channel = 'desktop', service = 'gmail') {
  await getMCPManager().addClient(`flo-${service}`, { command: 'inert', args: [] });
  const result = buildMCPAgentTools().find(t => t.name.endsWith(`__${service}_execute`))!;
  return guardToolWithApproval(result as PolicyAwareAgentTool, {
    channel, sessionId: 'test', cwd: '/inert', approvedRoots: [],
  });
}
async function pending() {
  await vi.waitFor(() => expect(ApprovalManager.getPending()).toHaveLength(1));
  return ApprovalManager.getPending()[0];
}
beforeEach(() => {
  transport.missing = false;
  transport.call.mockReset().mockImplementation(async (name: string) =>
    name.endsWith('_preview') ? JSON.stringify(snapshot()) : 'executed');
  ApprovalManager.setNotifier(() => true);
});
afterEach(async () => {
  ApprovalManager.setNotifier(null);
  await getMCPManager().stop();
});

describe('real proxy + policy guard + approval manager + MCP manager (inert client)', () => {
  it('shows stored destination/body/attachment and overrides; binds hashes and immutable IDs; consumes approval once', async () => {
    const t = await tool();
    const args = { proposal_ids: ['p1'], expected_payload_hashes: { p1: 'model supplied' }, override: true };
    const run = t.execute(args, context());
    args.proposal_ids[0] = 'changed';
    args.override = false;
    const request = await pending();
    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(request.details).toContain('recipient@example.test');
    expect(request.details).toContain('Exact stored body');
    expect(request.details).toContain('report.pdf');
    const details = JSON.parse(request.details);
    expect(details.arguments).toEqual({ proposal_ids: ['p1'], expected_payload_hashes: { p1: hash }, override: true });
    expect(details.proposals.proposals[0].preview.attachments[0]).toMatchObject({ size: 123, sha256: 'b'.repeat(64) });
    expect(ApprovalManager.resolve(request.id, 'approve', 'ui')).toBe(true);
    expect(ApprovalManager.resolve(request.id, 'approve', 'ui')).toBe(false);
    expect(await run).toBe('executed');
    expect(transport.call).toHaveBeenLastCalledWith('gmail_execute', details.arguments);
    const again = t.execute({ proposal_ids: ['p1'] }, context());
    const next = await pending();
    expect(next.id).not.toBe(request.id);
    ApprovalManager.resolve(next.id, 'deny', 'ui');
    await again;
    expect(transport.call.mock.calls.filter(([name]) => name === 'gmail_execute')).toHaveLength(1);
  });

  it('denies without execute', async () => {
    const run = (await tool()).execute({ proposal_ids: ['p1'] }, context());
    ApprovalManager.resolve((await pending()).id, 'deny', 'ui');
    expect(await run).toContain('blocked');
    expect(transport.call).toHaveBeenCalledTimes(1);
  });

  it('fails closed for old servers without preview', async () => {
    transport.missing = true;
    expect(await (await tool()).execute({ proposal_ids: ['p1'] }, context())).toContain('blocked');
    expect(transport.call).not.toHaveBeenCalled();
  });

  it.each(['telegram', 'scheduler'])('does not preview from %s', async channel => {
    expect(await (await tool(channel)).execute({ proposal_ids: ['p1'] }, context())).toContain('blocked');
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('checks cancellation before preview, after preview, and after approval', async () => {
    const t = await tool();
    const pre = new AbortController(); pre.abort();
    await t.execute({ proposal_ids: ['p1'] }, context(pre.signal));
    expect(transport.call).not.toHaveBeenCalled();
    const during = new AbortController();
    transport.call.mockImplementationOnce(async () => { during.abort(); return JSON.stringify(snapshot()); });
    expect(await t.execute({ proposal_ids: ['p1'] }, context(during.signal))).toContain('blocked');
    expect(ApprovalManager.getPending()).toHaveLength(0);
    const after = new AbortController();
    const run = t.execute({ proposal_ids: ['p1'] }, context(after.signal));
    ApprovalManager.resolve((await pending()).id, 'approve', 'ui'); after.abort();
    expect(await run).toContain('blocked');
    expect(transport.call.mock.calls.every(([name]) => name.endsWith('_preview'))).toBe(true);
  });

  it.each([
    '', 'Tool error: private provider detail', JSON.stringify({ version: 0, proposals: [proposal()] }),
    JSON.stringify({ version: 1, proposals: [] }),
    JSON.stringify({ version: 1, proposals: [{ ...proposal(), id: 'other' }] }),
    JSON.stringify({ version: 1, proposals: [{ ...proposal(), type: 'calendar.create' }] }),
    JSON.stringify({ version: 1, proposals: [{ ...proposal(), payload_hash: 'A'.repeat(64) }] }),
    JSON.stringify({ version: 1, proposals: [{ ...proposal(), preview: null }] }),
    JSON.stringify({ version: 1, proposals: [{ ...proposal(), preview: { attachments: [{ filename: 'bad', content: 'binary' }] } }] }),
    JSON.stringify({ version: 1, proposals: [{ ...proposal(), preview: { body: 'x'.repeat(100_001) } }] }),
    'x'.repeat(1024 * 1024 + 1),
  ])('rejects malformed/missing/oversized previews %# without confirmation', async raw => {
    transport.call.mockResolvedValue(raw);
    expect(await (await tool()).execute({ proposal_ids: ['p1'] }, context())).toContain('blocked');
    expect(ApprovalManager.getPending()).toHaveLength(0);
    expect(transport.call).toHaveBeenCalledTimes(1);
  });

  it.each([[], ['p1', 'p1'], Array.from({ length: 11 }, (_, i) => `p${i}`)])('rejects invalid requested IDs %# before preview', async ids => {
    expect(await (await tool()).execute({ proposal_ids: ids }, context())).toContain('blocked');
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('rejects duplicate snapshot IDs even with correct count', async () => {
    transport.call.mockResolvedValue(JSON.stringify({ version: 1, proposals: [proposal(), proposal()] }));
    expect(await (await tool()).execute({ proposal_ids: ['p1', 'p2'] }, context())).toContain('blocked');
    expect(ApprovalManager.getPending()).toHaveLength(0);
  });

  it('session cancellation while approval is pending blocks execution', async () => {
    const run = (await tool()).execute({ proposal_ids: ['p1'] }, context());
    const request = await pending();
    ApprovalManager.cancelSession('test');
    expect(ApprovalManager.resolve(request.id, 'approve', 'ui')).toBe(false);
    expect(await run).toContain('blocked');
    expect(transport.call).toHaveBeenCalledTimes(1);
  });

  it('does not echo credentials from execute errors', async () => {
    transport.call.mockImplementation(async (name: string) => name.endsWith('_preview')
      ? JSON.stringify(snapshot()) : 'Tool error: token=private-test-value');
    const run = (await tool()).execute({ proposal_ids: ['p1'] }, context());
    ApprovalManager.resolve((await pending()).id, 'approve', 'ui');
    expect(await run).toBe('MCP tool error (mcp__flo-gmail__gmail_execute): proposal execution failed; review before trying again.');
  });

  it('passes only reviewed stale hash to execute; never retries provider rejection', async () => {
    transport.call.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name.endsWith('_preview')) return JSON.stringify(snapshot());
      expect(args.expected_payload_hashes).toEqual({ p1: hash });
      throw new Error('Proposal changed; preview again');
    });
    const run = (await tool()).execute({ proposal_ids: ['p1'] }, context());
    ApprovalManager.resolve((await pending()).id, 'approve', 'ui');
    expect(await run).toContain('MCP tool error');
    expect(transport.call).toHaveBeenCalledTimes(2);
  });

  it.each([['calendar', 'calendar.create'], ['docs', 'drive.upload']])('prepares exact %s preview', async (service, type) => {
    transport.call.mockResolvedValue(JSON.stringify({ version: 1, proposals: [{ ...proposal(), type }] }));
    const run = (await tool('desktop', service)).execute({ proposal_ids: ['p1'], override_conflicts: true }, context());
    const request = await pending();
    expect(transport.call).toHaveBeenCalledWith(`${service}_preview`, { proposal_ids: ['p1'] });
    ApprovalManager.resolve(request.id, 'approve', 'ui');
    await run;
    expect(transport.call).toHaveBeenLastCalledWith(`${service}_execute`, {
      proposal_ids: ['p1'], override_conflicts: true, expected_payload_hashes: { p1: hash },
    });
  });
});
