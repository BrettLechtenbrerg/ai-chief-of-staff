import type Database from 'better-sqlite3';
import { ApprovalManager } from '../security/approval-manager';
import type { Fact } from './facts';
import type { SoulAspect } from './soul';

export interface CompactionSnapshot {
  readonly facts: readonly Readonly<Fact>[];
  readonly soul: readonly Readonly<SoulAspect>[];
}
const snapshots = new WeakMap<CompactionSnapshot, { db: Database.Database; revision: string; rows: string }>();
function revision(db: Database.Database): string {
  return JSON.stringify([db.pragma('data_version', { simple: true }), db.prepare('SELECT total_changes() AS n').get()]);
}
function rows(db: Database.Database): CompactionSnapshot {
  return {
    facts: db.prepare('SELECT * FROM facts ORDER BY id').all() as Fact[],
    soul: db.prepare('SELECT * FROM soul ORDER BY id').all() as SoulAspect[],
  };
}
export function snapshotCompaction(db: Database.Database, facts: boolean, soul: boolean): CompactionSnapshot {
  return db.transaction(() => {
    const raw = rows(db);
    const snapshot = Object.freeze({
      facts: Object.freeze((facts ? raw.facts : []).map((row) => Object.freeze(row))),
      soul: Object.freeze((soul ? raw.soul : []).map((row) => Object.freeze(row))),
    });
    snapshots.set(snapshot, { db, revision: revision(db), rows: JSON.stringify(raw) });
    return snapshot;
  })();
}
function invalid(): never { throw new Error('Invalid or unsafe memory compaction'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  if (Object.keys(value).some((key) => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return invalid();
  return value;
}
function array(value: unknown): unknown[] { return Array.isArray(value) && value.length <= 1000 ? value : invalid(); }
function unique(values: unknown[]): void { if (new Set(values).size !== values.length) invalid(); }
interface Transformation {
  readonly before: CompactionSnapshot;
  readonly after: CompactionSnapshot;
  readonly lossless: boolean;
}
function context(snapshot: CompactionSnapshot): string {
  return JSON.stringify({
    facts: snapshot.facts.map(({ category, subject, content }) => ({ category, subject, content })),
    soul: snapshot.soul.map(({ aspect, content }) => ({ aspect, content })),
  });
}
/** No instruction classifier is assumed: semantic edits always require complete review. */
function prepare(snapshot: CompactionSnapshot, output: unknown): Transformation {
  const root = object(output, ['facts', 'soul']);
  if (!Object.keys(root).length) invalid();
  let facts = [...snapshot.facts];
  let soul = [...snapshot.soul];
  let lossless = true;
  if ('facts' in root) {
    const section = object(root.facts, ['delete_ids', 'upsert']);
    const ids = array(section.delete_ids).map((id) => {
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return invalid();
      return id;
    });
    unique(ids);
    const originals = ids.map((id) => snapshot.facts.find((f) => f.id === id) ?? invalid());
    const replacements = array(section.upsert).map((value) => {
      const item = object(value, ['category', 'subject', 'content']);
      const category = text(item.category);
      if (typeof item.subject !== 'string') return invalid();
      const subject = item.subject;
      const content = text(item.content);
      // Preserve selected same-key ID/metadata; never overwrite unrelated keys.
      const original = originals.find((f) => f.category === category && f.subject === subject && f.content === content)
        ?? originals.find((f) => f.category === category && f.subject === subject) ?? invalid();
      if (snapshot.facts.some((f) => !ids.includes(f.id) && f.category === category && f.subject === subject)) invalid();
      return Object.freeze({ ...original, content });
    });
    unique(replacements.map((f) => JSON.stringify([f.category, f.subject])));
    if (!originals.length || !replacements.length) invalid();
    lossless = originals.every((f) => replacements.some((r) => r.category === f.category && r.subject === f.subject && r.content === f.content));
    facts = [...facts.filter((f) => !ids.includes(f.id)), ...replacements].sort((a, b) => a.id - b.id);
    if (context({ facts, soul: [] }).length >= context({ facts: snapshot.facts, soul: [] }).length) invalid();
  }
  if ('soul' in root) {
    const section = object(root.soul, ['delete_aspects', 'upsert']);
    const aspects = array(section.delete_aspects).map(text);
    unique(aspects);
    const originals = aspects.map((aspect) => snapshot.soul.find((s) => s.aspect === aspect) ?? invalid());
    const replacements = array(section.upsert).map((value) => {
      const item = object(value, ['aspect', 'content']);
      const aspect = text(item.aspect);
      const content = text(item.content);
      const original = originals.find((s) => s.aspect === aspect) ?? invalid();
      return Object.freeze({ ...original, content });
    });
    unique(replacements.map((s) => s.aspect));
    if (!originals.length || !replacements.length) invalid();
    lossless = lossless && originals.every((s) => replacements.some((r) => r.aspect === s.aspect && r.content === s.content));
    soul = [...soul.filter((s) => !aspects.includes(s.aspect)), ...replacements].sort((a, b) => a.id - b.id);
    if (context({ facts: [], soul }).length >= context({ facts: [], soul: snapshot.soul }).length) invalid();
  }
  const after = Object.freeze({ facts: Object.freeze(facts), soul: Object.freeze(soul) });
  if (context(after).length >= context(snapshot).length) invalid();
  return Object.freeze({ before: snapshot, after, lossless });
}
function assertCurrent(db: Database.Database, snapshot: CompactionSnapshot): void {
  const captured = snapshots.get(snapshot);
  if (!captured || captured.db !== db) invalid();
  if (captured.revision !== revision(db) || captured.rows !== JSON.stringify(rows(db))) {
    throw new Error('Memory changed during compaction');
  }
}
/** Private executor: only lossless apply or the captured approved closure reaches it.
 * Memory remains data, never authority to change tool-policy, ApprovalManager, or
 * canonical system hard rules. Review does not grant a bypass of those safeguards.
 */
function commit(db: Database.Database, snapshot: CompactionSnapshot, prepared: Transformation, signal?: AbortSignal): void {
  const captured = snapshots.get(snapshot) ?? invalid();
  try {
    db.transaction(() => {
      signal?.throwIfAborted();
      assertCurrent(db, snapshot);
      db.exec(`CREATE TABLE IF NOT EXISTS memory_compaction_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
        original_rows TEXT NOT NULL,
        transformation TEXT NOT NULL,
        reviewed INTEGER NOT NULL CHECK(reviewed IN (0, 1))
      )`);
      db.prepare('INSERT INTO memory_compaction_history (original_rows, transformation, reviewed) VALUES (?, ?, ?)')
        .run(captured.rows, JSON.stringify(prepared), prepared.lossless ? 0 : 1);
      for (const table of ['facts', 'soul'] as const) {
        for (const original of snapshot[table]) {
          const replacement = prepared.after[table].find((row) => row.id === original.id);
          if (!replacement) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(original.id);
          else if (replacement.content !== original.content) {
            db.prepare(`UPDATE ${table} SET content = ? WHERE id = ?`).run(replacement.content, original.id);
          }
        }
      }
      signal?.throwIfAborted();
    }).immediate();
  } finally {
    snapshots.delete(snapshot);
  }
}
/** Default API is strictly lossless exact-key/content deduplication. */
export function applyCompaction(db: Database.Database, snapshot: CompactionSnapshot, output: unknown, signal?: AbortSignal): void {
  assertCurrent(db, snapshot);
  const prepared = prepare(snapshot, output);
  if (!prepared.lossless) invalid();
  commit(db, snapshot, prepared, signal);
}
export interface CompactionReviewOptions {
  sessionId: string;
  channel: string;
  signal?: AbortSignal;
}
/** One-use approval stays in this closure, never supplied by JSON or caller.
 * Complete raw before/after strings avoid credential-key redaction in generic
 * approval serialization. Fail closed rather than truncate the review.
 */
export async function reviewAndApplyCompaction(
  db: Database.Database, snapshot: CompactionSnapshot, output: unknown, options: CompactionReviewOptions,
): Promise<boolean> {
  assertCurrent(db, snapshot);
  const prepared = prepare(snapshot, output);
  const { sessionId, channel, signal } = options;
  if (prepared.lossless) {
    commit(db, snapshot, prepared, signal);
    return true;
  }
  const args = Object.freeze({
    warning: 'Review every original and replacement. Unlabelled instructions may change. Originals are retained privately for recovery. This cannot change tool policy, approvals, or canonical system hard rules.',
    before: JSON.stringify(prepared.before),
    after: JSON.stringify(prepared.after),
  });
  try {
    signal?.throwIfAborted();
    if (JSON.stringify(args, null, 2).length > 100_000) invalid();
    if (!await ApprovalManager.request({ toolName: 'compact_memory', capability: 'local-write', args, sessionId, channel, signal })) return false;
    // Execute the immutable capture, never the potentially changed caller output.
    commit(db, snapshot, prepared, signal);
    return true;
  } finally {
    snapshots.delete(snapshot);
  }
}
/** Private local recovery only; never add archive rows to model context or logs. */
export function getCompactionHistory(db: Database.Database, id: number): {
  id: number; created_at: string; original_rows: string; transformation: string; reviewed: number;
} | undefined {
  if (!Number.isSafeInteger(id) || id <= 0) invalid();
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_compaction_history'").get()) return undefined;
  return db.prepare('SELECT * FROM memory_compaction_history WHERE id = ?').get(id) as ReturnType<typeof getCompactionHistory>;
}
export function parseCompactionResponse(text: string): unknown {
  const raw = text.trim();
  const fenced = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  try {
    return JSON.parse(fenced ? fenced[1] : raw) as unknown;
  } catch {
    throw new Error('Invalid memory compaction JSON');
  }
}
