import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProposalCache } from '../../vendor/flo-mcp-servers/shared/dist/proposal-cache.js';

describe('Flo proposal preview and atomic approval binding', () => {
  let directory: string;
  let cache: InstanceType<typeof ProposalCache>;
  let peer: InstanceType<typeof ProposalCache>;
  const save = (id = 'p_one', payload: object = { to: ['recipient@example.test'], body: 'Full body' }, type = 'gmail.send') => {
    cache.saveProposal({ id, client_action_id: id, type, payload, risk: 'low', violations: [], created_at: new Date().toISOString(), executed: false });
  };
  const hashes = (ids = ['p_one'], service = 'gmail'): Record<string, string> => Object.fromEntries(
    cache.previewProposals(ids, service).proposals.map((p: { id: string; payload_hash: string }) => [p.id, p.payload_hash]),
  );
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'flo-approval-'));
    cache = new ProposalCache(join(directory, 'proposals.db'));
    peer = new ProposalCache(join(directory, 'proposals.db'));
  });
  afterEach(() => { peer.close(); cache.close(); rmSync(directory, { recursive: true, force: true }); });

  it('returns machine-readable full text and attachment metadata without a 64KB binary limit', () => {
    const binary = Buffer.alloc(100_000, 42);
    const body = 'x'.repeat(70_000);
    save('p_one', { to: ['a@example.test'], cc: ['b@example.test'], bcc: ['c@example.test'], body,
      attachments: [{ filename: 'data.bin', content: binary.toString('base64'), size: 1, mimeType: 'application/octet-stream' }] });
    const result = JSON.parse(cache.previewTool({ proposal_ids: ['p_one'] }, 'gmail').content[0].text);
    expect(result.version).toBe(1);
    expect(result.proposals[0].preview.body).toBe(body);
    expect(result.proposals[0].preview.attachments[0]).toEqual({ filename: 'data.bin', size: binary.length,
      mimeType: 'application/octet-stream', sha256: createHash('sha256').update(binary).digest('hex') });
    expect(cache.previewProposals(['p_one'], 'gmail')).toEqual(result);
    expect((cache.db.prepare('SELECT COUNT(*) AS n FROM proposal_execution_claims_v1').get() as { n: number }).n).toBe(0);
  });

  it('allows only one claimant across two SQLite connections, even while an external await is pending', async () => {
    save();
    const expected = hashes();
    let sends = 0;
    const execute = async (connection: typeof cache) => {
      const captured = connection.claimProposals(['p_one'], expected, 'gmail');
      await Promise.resolve();
      sends++;
      return captured;
    };
    const results = await Promise.allSettled([execute(cache), execute(peer)]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(sends).toBe(1);
    expect(() => peer.claimProposals(['p_one'], expected, 'gmail')).toThrow(/reconcile/);
  });

  it('rejects changed destination/body and rolls back the entire claim batch', () => {
    save(); save('p_two');
    const expected = hashes(['p_one', 'p_two']);
    peer.db.prepare('UPDATE proposals SET payload = ? WHERE id = ?').run(JSON.stringify({ to: ['changed@example.test'], body: 'changed' }), 'p_two');
    expect(() => cache.claimProposals(['p_one', 'p_two'], expected, 'gmail')).toThrow(/changed/);
    expect((cache.db.prepare('SELECT COUNT(*) AS n FROM proposal_execution_claims_v1').get() as { n: number }).n).toBe(0);
    expect(cache.claimProposals(['p_one'], { p_one: expected.p_one }, 'gmail')).toHaveLength(1);
  });

  it('binds attachment bytes and proposal type, not only visible summaries', () => {
    save('p_one', { attachments: [{ filename: 'a.bin', content: 'YQ==' }] });
    const expected = hashes();
    peer.db.prepare('UPDATE proposals SET payload = ? WHERE id = ?').run(JSON.stringify({ attachments: [{ filename: 'a.bin', content: 'Yg==' }] }), 'p_one');
    expect(() => cache.claimProposals(['p_one'], expected, 'gmail')).toThrow(/changed/);
    const next = hashes();
    peer.db.prepare('UPDATE proposals SET type = ? WHERE id = ?').run('gmail.delete', 'p_one');
    expect(() => cache.claimProposals(['p_one'], next, 'gmail')).toThrow(/changed/);
  });

  it('executes the captured snapshot, retains ambiguous claims after reopen, and records success', () => {
    save();
    const expected = hashes();
    const [captured] = cache.claimProposals(['p_one'], expected, 'gmail');
    peer.db.prepare('UPDATE proposals SET payload = ? WHERE id = ?').run('{"body":"changed"}', 'p_one');
    expect(captured!.payload.body).toBe('Full body');
    cache.close(); cache = new ProposalCache(join(directory, 'proposals.db'));
    expect(() => cache.claimProposals(['p_one'], expected, 'gmail')).toThrow(/reconcile/);
    cache.markExecuted('p_one', { provider_id: 'inert-receipt' });
    expect(cache.getProposal('p_one')!.receipt).toEqual({ provider_id: 'inert-receipt' });
  });

  it('fails closed on absent hashes, invalid/missing/wrong-service IDs and oversized full text', () => {
    save();
    for (const ids of [[], ['p_one', 'p_one'], ['missing'], ['bad/id'], Array.from({ length: 11 }, (_, i) => `p_${i}`)]) {
      expect(() => cache.previewProposals(ids, 'gmail')).toThrow();
    }
    expect(() => cache.previewProposals(['p_one'], 'docs')).toThrow();
    expect(() => cache.claimProposals(['p_one'], undefined, 'gmail')).toThrow(/expected_payload_hashes/);
    expect(() => cache.claimProposals(['p_one'], { p_one: '0'.repeat(64), extra: '0'.repeat(64) }, 'gmail')).toThrow();
    save('p_large', { content: 'x'.repeat(1024 * 1024) }, 'drive.upload');
    expect(() => cache.previewProposals(['p_large'], 'docs')).toThrow(/Nothing was truncated/);
    expect(cache.getProposal('p_large')!.payload.content.length).toBe(1024 * 1024);
  });

  it.each(['gmail', 'calendar', 'docs'])('%s handlers claim before await and use captured proposals', service => {
    const source = readFileSync(new URL(`../../vendor/flo-mcp-servers/${service}/index.js`, import.meta.url), 'utf8');
    expect(source).toContain(`name: '${service}_preview'`);
    expect(source).toContain(`proposalCache.previewTool(request.params.arguments, '${service}')`);
    expect(source).toContain("required: ['proposal_ids', 'expected_payload_hashes']");
    const execute = source.slice(source.indexOf('async handleExecute(args)'), source.indexOf('async handleExecute(args)') + 1500);
    expect(execute.indexOf('claimProposals(')).toBeLessThan(execute.indexOf('await '));
    expect(execute).toContain('for (const proposal of claimed)');
    expect(execute).not.toContain('getProposal(');
  });
});
