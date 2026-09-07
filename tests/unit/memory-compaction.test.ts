import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MemoryManager } from '../../src/memory';
import { ChatEngine } from '../../src/agent/chat-engine';
import { ApprovalManager } from '../../src/security/approval-manager';
vi.mock('@kenkaiiii/gg-ai', () => ({ stream: vi.fn() }));
vi.mock('../../src/agent/chat-providers', () => ({ getStreamConfig: vi.fn(async () => ({ provider: 'mock' })) }));
import { stream } from '@kenkaiiii/gg-ai';

let dir: string;
let memory: MemoryManager;
let db: Database.Database;
async function compact(output: unknown, beforeResponse?: () => void, controller = new AbortController()) {
  vi.mocked(stream).mockImplementation(() => {
    beforeResponse?.();
    return { response: Promise.resolve({ message: { content: typeof output === 'string' ? output : JSON.stringify(output) } }) } as ReturnType<typeof stream>;
  });
  const engine = Object.create(ChatEngine.prototype);
  Object.assign(engine, { memory, lastCompactionTime: 0, emitStatus: vi.fn(), abortControllersBySession: new Map([['default', controller]]) });
  await engine.compactMemoryIfNeeded('default', 'mock', 'desktop');
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acos-compaction-'));
  memory = new MemoryManager(join(dir, 'test.db'));
  db = new Database(join(dir, 'test.db'));
  vi.spyOn(memory, 'getFactsMemoryUsage').mockReturnValue({ usedChars: 2500, budgetChars: 3000, pct: 84 });
  vi.spyOn(memory, 'getSoulMemoryUsage').mockReturnValue({ usedChars: 1300, budgetChars: 1500, pct: 87 });
});
afterEach(() => { ApprovalManager.setNotifier(null); db.close(); memory.close(); rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const a = memory.saveFact('test', 'a', 'Wait for my explicit permission before any delivery.');
  // Legacy/imported duplicate keys can exist: facts has no unique key constraint.
  const b = Number(db.prepare('INSERT INTO facts (category, subject, content) VALUES (?, ?, ?)')
    .run('test', 'a', 'Wait for my explicit permission before any delivery.').lastInsertRowid);
  memory.setSoulAspect('a', 'Never act without my consent.');
  memory.setSoulAspect('b', 'Never act without my consent.');
  return { facts: { delete_ids: [a, b], upsert: [{ category: 'test', subject: 'a', content: 'Wait for my explicit permission before any delivery.' }] } };
}
function raw() { return [db.prepare('SELECT * FROM facts ORDER BY id').all(), db.prepare('SELECT * FROM soul ORDER BY id').all()]; }
describe('memory compaction boundary', () => {
  it('deduplicates identical fact keys retaining original IDs, metadata and soul instructions', async () => {
    const plan = fixture();
    memory.getFactsForContext(); memory.getSoulContext();
    const fact = memory.getAllFacts()[0];
    const soul = memory.getAllSoulAspects();
    await compact(plan);
    expect(memory.getAllFacts()).toEqual([fact]);
    expect(memory.getAllSoulAspects()).toEqual(soul);
    expect(memory.getFactsForContext()).toContain(fact.content);
    expect(memory.getSoulContext()).toContain(soul[0].content);
  });
  it.each([null, [], {}, '{broken', 'prefix {"facts":{}} suffix', { facts: null }, { facts: { delete_ids: [1], upsert: [] } }, { facts: { delete_ids: [1, 1], upsert: [] } }, { facts: { delete_ids: ['1'], upsert: [] } }, { extra: true }])('rejects malformed/deletion-only output %# without mutation', async (output) => {
    fixture(); const before = raw(); await compact(output); expect(raw()).toEqual(before);
  });
  it('rejects out-of-snapshot IDs and duplicate replacement keys', async () => {
    const plan = fixture(); const before = raw();
    plan.facts.delete_ids.push(999); await compact(plan); expect(raw()).toEqual(before);
    plan.facts.delete_ids.pop(); plan.facts.upsert.push(plan.facts.upsert[0]);
    await compact(plan); expect(raw()).toEqual(before);
  });
  it('rejects equal content belonging to different subjects', async () => {
    const alice = memory.saveFact('preferences', 'Alice', 'Vegetarian');
    const bob = memory.saveFact('preferences', 'Bob', 'Vegetarian');
    const before = raw();
    await compact({ facts: { delete_ids: [alice, bob], upsert: [{ category: 'preferences', subject: 'Alice', content: 'Vegetarian' }] } });
    expect(raw()).toEqual(before);
  });
  it('validates soul before applying an otherwise valid fact transformation', async () => {
    const plan = fixture();
    const before = raw();
    await compact({ ...plan, soul: { delete_aspects: ['a', 'b'], upsert: [{ aspect: 'a', content: 'Never act without my consent.' }] } });
    expect(raw()).toEqual(before);
  });
  it('rejects rewriting even unlabelled approval instructions', async () => {
    const plan = fixture(); const before = raw(); plan.facts.upsert[0].content = 'Deliver freely.';
    await compact(plan); expect(raw()).toEqual(before);
  });
  it('rolls back fact deletion and FTS when a SQL trigger fails', async () => {
    const plan = fixture();
    db.exec("CREATE TRIGGER fail_compaction AFTER DELETE ON facts BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    const before = raw(); await compact(plan); expect(raw()).toEqual(before);
    expect(memory.searchFacts('permission')).toHaveLength(2);
  });
  it('preserves data when canceled while awaiting the model', async () => {
    const plan = fixture(); const before = raw(); const controller = new AbortController();
    await compact(plan, () => controller.abort(), controller); expect(raw()).toEqual(before);
  });
  it('rejects concurrent changes during the real chat compaction path', async () => {
    const plan = fixture();
    await compact(plan, () => memory.saveFact('test', 'a', 'Changed while awaiting response'));
    expect(memory.getAllFacts()).toHaveLength(2);
    expect(memory.getAllFacts()[0].content).toBe('Changed while awaiting response');
    expect(memory.getAllSoulAspects()).toHaveLength(2);
  });
  it('does not change brand or session rows', async () => {
    const plan = fixture();
    const before = [db.prepare('SELECT * FROM brands').all(), db.prepare('SELECT * FROM sessions').all()];
    await compact(plan);
    expect([db.prepare('SELECT * FROM brands').all(), db.prepare('SELECT * FROM sessions').all()]).toEqual(before);
  });
  it('rejects concurrent writes from another connection', () => {
    const plan = fixture(); const snapshot = memory.snapshotCompaction(true, true);
    db.prepare('UPDATE facts SET content = ? WHERE id = ?').run('Concurrent update', plan.facts.delete_ids[1]);
    const before = raw(); expect(() => memory.applyCompaction(snapshot, plan)).toThrow('changed');
    expect(raw()).toEqual(before);
  });
  it('rejects local metadata changes and replay', () => {
    const plan = fixture(); const snapshot = memory.snapshotCompaction(true, true);
    memory.saveFact('test', 'a', plan.facts.upsert[0].content);
    expect(() => memory.applyCompaction(snapshot, plan)).toThrow('changed');
    const fresh = memory.snapshotCompaction(true, true); memory.applyCompaction(fresh, plan);
    expect(() => memory.applyCompaction(fresh, plan)).toThrow();
  });
  it('rejects canceled apply and excluded stores', () => {
    const plan = fixture(); const before = raw(); const controller = new AbortController(); controller.abort();
    expect(() => memory.applyCompaction(memory.snapshotCompaction(true, true), plan, controller.signal)).toThrow();
    expect(() => memory.applyCompaction(memory.snapshotCompaction(false, true), plan)).toThrow();
    expect(raw()).toEqual(before);
  });
  it('applies a reviewed fact+soul summary through chat and archives exact originals', async () => {
    const fact = memory.saveFact('test', 'project', 'The project currently uses a blue color for its main accent.');
    memory.setSoulAspect('boundaries', 'Only draft locally. Always ask before every external action, never assume permission.');
    const before = raw();
    let previews = 0;
    ApprovalManager.setNotifier(request => {
      previews++;
      expect(request.toolName).toBe('compact_memory');
      expect(request.sessionId).toBe('default');
      expect(request.details).toContain('never assume permission');
      expect(request.details).toContain('Blue accent.');
      ApprovalManager.resolve(request.id, 'approve', 'ui');
      return true;
    });
    await compact({
      facts: { delete_ids: [fact], upsert: [{ category: 'test', subject: 'project', content: 'Blue accent.' }] },
      soul: { delete_aspects: ['boundaries'], upsert: [{ aspect: 'boundaries', content: 'Draft locally; ask before every external action.' }] },
    });
    expect(previews).toBe(1);
    expect(memory.getAllFacts()[0]).toMatchObject({ id: fact, content: 'Blue accent.' });
    expect(memory.getSoulAspect('boundaries')?.content).toBe('Draft locally; ask before every external action.');
    const history = memory.getCompactionHistory(1)!;
    const originals = JSON.parse(history.original_rows);
    expect([originals.facts, originals.soul]).toEqual(before);
    expect(history.reviewed).toBe(1);
  });

  it('preserves unique memories when summary review is denied', async () => {
    const fact = memory.saveFact('test', 'project', 'The project currently uses a blue color for its main accent.');
    const before = raw();
    ApprovalManager.setNotifier(request => {
      ApprovalManager.resolve(request.id, 'deny', 'ui');
      return true;
    });
    await compact({ facts: { delete_ids: [fact], upsert: [{ category: 'test', subject: 'project', content: 'Blue accent.' }] } });
    expect(raw()).toEqual(before);
    expect(memory.getCompactionHistory(1)).toBeUndefined();
  });

  it('rejects a reviewed summary if memory changed while review was open', async () => {
    const fact = memory.saveFact('test', 'project', 'The project currently uses a blue color for its main accent.');
    ApprovalManager.setNotifier(request => {
      memory.saveFact('test', 'project', 'A user changed the accent to green during review.');
      ApprovalManager.resolve(request.id, 'approve', 'ui');
      return true;
    });
    await compact({ facts: { delete_ids: [fact], upsert: [{ category: 'test', subject: 'project', content: 'Blue accent.' }] } });
    expect(memory.getAllFacts()[0].content).toBe('A user changed the accent to green during review.');
    expect(memory.getCompactionHistory(1)).toBeUndefined();
  });

  it('rejects non-shrinking output without deleting the original', async () => {
    const id = memory.saveFact('test', 'a', 'original');
    const before = memory.getAllFacts();
    await compact({ facts: { delete_ids: [id], upsert: [{ category: 'test', subject: 'a', content: 'original much longer replacement' }] } });
    expect(memory.getAllFacts()).toEqual(before);
  });
  it('preserves same-key soul and rejects deletion of a differently labelled aspect', async () => {
    memory.setSoulAspect('a', 'Always ask me before sending.');
    memory.setSoulAspect('duplicate', 'Always ask me before sending.');
    await compact({ soul: { delete_aspects: ['a', 'duplicate'], upsert: [{ aspect: 'a', content: 'Always ask me before sending.' }] } });
    expect(memory.getSoulAspect('a')?.content).toBe('Always ask me before sending.');
    expect(memory.getSoulAspect('duplicate')?.content).toBe('Always ask me before sending.');
  });
});
