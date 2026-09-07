import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MemoryManager } from '../../src/memory';
import { ApprovalManager, type ApprovalRequest } from '../../src/security/approval-manager';

let dir: string;
let memory: MemoryManager;
let db: Database.Database;
const options = { sessionId: 'default', channel: 'desktop' };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acos-compaction-storage-'));
  memory = new MemoryManager(join(dir, 'test.db'));
  db = new Database(join(dir, 'test.db'));
});
afterEach(() => {
  ApprovalManager.setNotifier(null);
  db.close(); memory.close(); rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const id = memory.saveFact('test', 'a', 'Always wait for my explicit approval before sending any delivery.');
  memory.setSoulAspect('style', 'Be concise and polite in every conversation with me.');
  return {
    facts: { delete_ids: [id], upsert: [{ category: 'test', subject: 'a', content: 'Ask before sending.' }] },
    soul: { delete_aspects: ['style'], upsert: [{ aspect: 'style', content: 'Concise and polite.' }] },
  };
}
function raw() { return { facts: db.prepare('SELECT * FROM facts ORDER BY id').all(), soul: db.prepare('SELECT * FROM soul ORDER BY id').all() }; }
function approve(before?: (request: ApprovalRequest) => void) {
  ApprovalManager.setNotifier((request) => {
    before?.(request);
    ApprovalManager.resolve(request.id, 'approve', 'ui');
    return true;
  });
}
describe('review-bound atomic compaction storage', () => {
  it('reviews complete same-key fact+soul summary, retains metadata and archives originals', async () => {
    const plan = fixture();
    memory.getFactsForContext(); memory.getSoulContext();
    const before = raw();
    approve((request) => {
      expect(request.toolName).toBe('compact_memory');
      expect(request.capability).toBe('local-write');
      const preview = JSON.parse(request.details);
      expect(JSON.parse(preview.before)).toEqual(before);
      expect(JSON.parse(preview.after).facts[0].content).toBe('Ask before sending.');
    });
    expect(await memory.reviewAndApplyCompaction(memory.snapshotCompaction(true, true), plan, options)).toBe(true);
    expect(memory.getAllFacts()[0]).toEqual({ ...(before.facts[0] as object), content: 'Ask before sending.' });
    expect(memory.getAllSoulAspects()[0]).toEqual({ ...(before.soul[0] as object), content: 'Concise and polite.' });
    expect(JSON.parse(memory.getCompactionHistory(1)!.original_rows)).toEqual(before);
    expect(memory.getCompactionHistory(1)!.reviewed).toBe(1);
    expect(memory.getFactsForContext()).toContain('Ask before sending.');
    expect(memory.getSoulContext()).toContain('Concise and polite.');
  });
  it('never accepts semantic changes or JSON approval through raw apply', () => {
    const plan = fixture(); const before = raw();
    expect(() => memory.applyCompaction(memory.snapshotCompaction(true, true), plan)).toThrow();
    expect(() => memory.applyCompaction(memory.snapshotCompaction(true, true), { ...plan, approved: true })).toThrow();
    expect(raw()).toEqual(before);
  });
  it('captures exact proposal before approval and rejects replay', async () => {
    const plan = fixture(); const snapshot = memory.snapshotCompaction(true, true);
    approve(() => { plan.facts.upsert[0].content = 'Send freely.'; });
    await memory.reviewAndApplyCompaction(snapshot, plan, options);
    expect(memory.getAllFacts()[0].content).toBe('Ask before sending.');
    await expect(memory.reviewAndApplyCompaction(snapshot, plan, options)).rejects.toThrow();
  });
  it.each(['no-ui', 'deny', 'cancel', 'remote'])('preserves originals for %s', async (mode) => {
    const plan = fixture(); const before = raw(); const controller = new AbortController();
    if (mode === 'deny') ApprovalManager.setNotifier((r) => { ApprovalManager.resolve(r.id, 'deny', 'ui'); return true; });
    if (mode === 'cancel') ApprovalManager.setNotifier(() => { controller.abort(); return true; });
    if (mode === 'remote') approve();
    const snapshot = memory.snapshotCompaction(true, true);
    expect(await memory.reviewAndApplyCompaction(snapshot, plan, { ...options, channel: mode === 'remote' ? 'telegram' : 'desktop', signal: controller.signal })).toBe(false);
    expect(raw()).toEqual(before);
    expect(memory.getCompactionHistory(1)).toBeUndefined();
    await expect(memory.reviewAndApplyCompaction(snapshot, plan, options)).rejects.toThrow();
  });
  it('cancels after a grant but before commit without writing or caching changes', async () => {
    const plan = fixture(); const before = raw(); const controller = new AbortController();
    ApprovalManager.setNotifier((request) => {
      ApprovalManager.resolve(request.id, 'approve', 'ui');
      controller.abort();
      return true;
    });
    const snapshot = memory.snapshotCompaction(true, true);
    await expect(memory.reviewAndApplyCompaction(snapshot, plan, { ...options, signal: controller.signal })).rejects.toThrow();
    expect(raw()).toEqual(before);
    expect(memory.getCompactionHistory(1)).toBeUndefined();
    await expect(memory.reviewAndApplyCompaction(snapshot, plan, options)).rejects.toThrow();
  });
  it('rejects plans targeting an excluded store', async () => {
    const plan = fixture(); const before = raw();
    await expect(memory.reviewAndApplyCompaction(memory.snapshotCompaction(true, false), plan, options)).rejects.toThrow();
    expect(raw()).toEqual(before);
  });
  it.each(['external', 'local'])('rejects %s concurrent change during review', async (mode) => {
    const plan = fixture();
    approve(() => {
      if (mode === 'external') db.prepare('UPDATE soul SET content = ?').run('Concurrent change');
      else memory.setSoulAspect('style', 'Concurrent change');
    });
    await expect(memory.reviewAndApplyCompaction(memory.snapshotCompaction(true, true), plan, options)).rejects.toThrow('changed');
    expect(memory.getAllFacts()[0].content).toContain('explicit approval');
    expect(memory.getSoulAspect('style')!.content).toBe('Concurrent change');
    expect(memory.getCompactionHistory(1)).toBeUndefined();
  });
  it.each(['write', 'archive'])('rolls back all changes on %s failure', async (mode) => {
    const plan = fixture(); const before = raw();
    if (mode === 'write') db.exec("CREATE TRIGGER fail_write AFTER UPDATE ON soul BEGIN SELECT RAISE(ABORT, 'forced'); END");
    else db.exec(`CREATE TABLE memory_compaction_history (id INTEGER PRIMARY KEY, created_at TEXT, original_rows TEXT, transformation TEXT, reviewed INTEGER);
      CREATE TRIGGER fail_archive AFTER INSERT ON memory_compaction_history BEGIN SELECT RAISE(ABORT, 'forced'); END`);
    approve();
    const snapshot = memory.snapshotCompaction(true, true);
    await expect(memory.reviewAndApplyCompaction(snapshot, plan, options)).rejects.toThrow('forced');
    expect(raw()).toEqual(before);
    expect(memory.getCompactionHistory(1)).toBeUndefined();
    expect(memory.searchFacts('approval')).toHaveLength(1);
    await expect(memory.reviewAndApplyCompaction(snapshot, plan, options)).rejects.toThrow();
  });
  it.each(['nonshrinking', 'deletion', 'outside', 'duplicate', 'conflict', 'empty', 'oversized-array'])('rejects %s plans before approval', async (mode) => {
    const plan = fixture(); const before = raw();
    if (mode === 'nonshrinking') plan.soul.upsert[0].content = 'x'.repeat(100);
    if (mode === 'deletion') plan.facts.upsert = [];
    if (mode === 'outside') plan.facts.delete_ids = [999];
    if (mode === 'duplicate') plan.facts.upsert.push(plan.facts.upsert[0]);
    if (mode === 'conflict') plan.facts.upsert[0].subject = 'unselected';
    if (mode === 'empty') plan.facts.upsert[0].content = '';
    if (mode === 'oversized-array') plan.facts.delete_ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    await expect(memory.reviewAndApplyCompaction(memory.snapshotCompaction(true, true), plan, options)).rejects.toThrow();
    expect(raw()).toEqual(before);
    expect(ApprovalManager.getPending()).toHaveLength(0);
  });
  it('rejects destination duplicate keys outside the selection', async () => {
    const plan = fixture();
    db.prepare('INSERT INTO facts (category, subject, content) VALUES (?, ?, ?)').run('test', 'a', 'Unrelated');
    const before = raw();
    await expect(memory.reviewAndApplyCompaction(memory.snapshotCompaction(true, true), plan, options)).rejects.toThrow();
    expect(raw()).toEqual(before);
  });
  it('fails closed on complete previews exceeding 100k, without truncation', async () => {
    const plan = fixture(); memory.saveFact('test', 'a', 'x'.repeat(100_000));
    const before = raw(); approve();
    await expect(memory.reviewAndApplyCompaction(memory.snapshotCompaction(true, true), plan, options)).rejects.toThrow();
    expect(raw()).toEqual(before);
  });
  it('archives automatic exact-key/content dedup without any review', () => {
    const plan = fixture();
    const original = memory.getAllFacts()[0];
    const duplicate = Number(db.prepare('INSERT INTO facts (category, subject, content) VALUES (?, ?, ?)').run(original.category, original.subject, original.content).lastInsertRowid);
    memory.applyCompaction(memory.snapshotCompaction(true, false), { facts: { delete_ids: [original.id, duplicate], upsert: [{ category: original.category, subject: original.subject, content: original.content }] } });
    expect(memory.getAllFacts()).toEqual([original]);
    expect(memory.getCompactionHistory(1)!.reviewed).toBe(0);
    expect(ApprovalManager.getPending()).toHaveLength(0);
    expect(plan.soul.delete_aspects).toEqual(['style']);
  });
});
