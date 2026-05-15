import Database from 'better-sqlite3';

// ============ Types ============

export interface Fact {
  id: number;
  category: string;
  subject: string;
  content: string;
  importance: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Cache for facts context — invalidated on any fact mutation.
 */
export interface FactsCache {
  contextCache: string | null;
  contextCacheValid: boolean;
}

/**
 * Create a fresh (empty) FactsCache.
 */
export function createFactsCache(): FactsCache {
  return { contextCache: null, contextCacheValid: false };
}

// ============ Memory budget constants ============

/** Hard character budget for facts injected into the system prompt (~1,000 tokens) */
export const FACTS_CHAR_BUDGET = 3000;

// ============ Fact CRUD methods ============

/**
 * Save a fact to long-term memory (with embedding)
 */
export function saveFact(
  db: Database.Database,
  category: string,
  subject: string,
  content: string,
  cache: FactsCache
): number {
  const existing = db
    .prepare(
      `
      SELECT id FROM facts WHERE category = ? AND subject = ?
    `
    )
    .get(category, subject) as { id: number } | undefined;

  let factId: number;

  if (existing) {
    db.prepare(
      `
        UPDATE facts SET content = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?
      `
    ).run(content, existing.id);
    factId = existing.id;
  } else {
    const stmt = db.prepare(`
        INSERT INTO facts (category, subject, content)
        VALUES (?, ?, ?)
      `);
    const result = stmt.run(category, subject, content);
    factId = result.lastInsertRowid as number;
  }

  // Invalidate facts context cache
  cache.contextCacheValid = false;

  return factId;
}

/**
 * Get all facts ordered by category and subject.
 */
export function getAllFacts(db: Database.Database): Fact[] {
  const stmt = db.prepare(`
      SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
      FROM facts
      ORDER BY category, subject
    `);
  return stmt.all() as Fact[];
}

/**
 * Format a single fact line for context injection.
 */
function formatFactLine(fact: Fact): string {
  return fact.subject ? `- **${fact.subject}**: ${fact.content}` : `- ${fact.content}`;
}

/**
 * Get facts formatted for context injection.
 * Sorts by importance DESC, truncates at FACTS_CHAR_BUDGET, and includes
 * a usage header with memory pressure warning when >80% full.
 * Uses the cache to avoid re-computing when nothing has changed.
 */
export function getFactsForContext(db: Database.Database, cache: FactsCache): string {
  // Return cached result if valid (avoids repeated DB queries on every message)
  if (cache.contextCacheValid && cache.contextCache !== null) {
    return cache.contextCache;
  }

  // Fetch facts sorted by importance DESC, then recency
  const facts = db
    .prepare(
      `SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
       FROM facts
       ORDER BY importance DESC, updated_at DESC`
    )
    .all() as Fact[];

  if (facts.length === 0) {
    cache.contextCache = '';
    cache.contextCacheValid = true;
    return '';
  }

  // Build fact lines, accumulating chars up to budget
  // Reserve space for the header line (estimated ~80 chars max)
  const headerReserve = 100;
  const contentBudget = FACTS_CHAR_BUDGET - headerReserve;

  const includedFacts: Fact[] = [];
  const byCategory = new Map<string, Fact[]>();
  let usedChars = 0;

  for (const fact of facts) {
    const line = formatFactLine(fact);
    // Account for category header if this is the first fact in its category
    const categoryHeader = byCategory.has(fact.category) ? '' : `\n### ${fact.category}\n`;
    const additionalChars = categoryHeader.length + line.length + 1; // +1 for newline

    if (usedChars + additionalChars > contentBudget) break;

    usedChars += additionalChars;
    includedFacts.push(fact);

    const list = byCategory.get(fact.category) || [];
    list.push(fact);
    byCategory.set(fact.category, list);
  }

  // Update last_accessed_at for included facts
  if (includedFacts.length > 0) {
    const ids = includedFacts.map((f) => f.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE facts SET last_accessed_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  // Build header
  const header = `## Known Facts`;

  const lines: string[] = [header];
  for (const [category, categoryFacts] of byCategory) {
    lines.push(`\n### ${category}`);
    for (const fact of categoryFacts) {
      lines.push(formatFactLine(fact));
    }
  }

  const result = lines.join('\n');
  cache.contextCache = result;
  cache.contextCacheValid = true;
  return result;
}

/**
 * Get memory usage stats for the facts budget.
 */
export function getFactsMemoryUsage(db: Database.Database): {
  usedChars: number;
  budgetChars: number;
  pct: number;
} {
  const facts = db
    .prepare(
      `SELECT category, subject, content FROM facts ORDER BY importance DESC, updated_at DESC`
    )
    .all() as Array<{ category: string; subject: string; content: string }>;

  const headerReserve = 100;
  const contentBudget = FACTS_CHAR_BUDGET - headerReserve;
  const seenCategories = new Set<string>();
  let usedChars = 0;

  for (const fact of facts) {
    const line = fact.subject ? `- **${fact.subject}**: ${fact.content}` : `- ${fact.content}`;
    const categoryHeader = seenCategories.has(fact.category) ? '' : `\n### ${fact.category}\n`;
    const additionalChars = categoryHeader.length + line.length + 1;

    if (usedChars + additionalChars > contentBudget) break;

    usedChars += additionalChars;
    seenCategories.add(fact.category);
  }

  const totalChars = usedChars + headerReserve;
  const pct = Math.round((totalChars / FACTS_CHAR_BUDGET) * 100);
  return { usedChars: totalChars, budgetChars: FACTS_CHAR_BUDGET, pct };
}

/**
 * Delete a fact by ID. Returns true if a row was deleted.
 */
export function deleteFact(db: Database.Database, id: number, cache: FactsCache): boolean {
  const stmt = db.prepare('DELETE FROM facts WHERE id = ?');
  const result = stmt.run(id);
  if (result.changes > 0) {
    cache.contextCacheValid = false; // Invalidate cache
  }
  return result.changes > 0;
}

/**
 * Delete a fact by category + subject. Returns true if a row was deleted.
 */
export function deleteFactBySubject(
  db: Database.Database,
  category: string,
  subject: string,
  cache: FactsCache
): boolean {
  const stmt = db.prepare('DELETE FROM facts WHERE category = ? AND subject = ?');
  const result = stmt.run(category, subject);
  if (result.changes > 0) {
    cache.contextCacheValid = false; // Invalidate cache
  }
  return result.changes > 0;
}

/**
 * Simple LIKE-based fact search by content, subject, or category.
 */
export function searchFacts(db: Database.Database, query: string, category?: string): Fact[] {
  const pattern = `%${query}%`;
  if (category) {
    return db
      .prepare(
        `SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
         FROM facts
         WHERE category = ? AND (content LIKE ? OR subject LIKE ?)
         ORDER BY updated_at DESC
         LIMIT 6`
      )
      .all(category, pattern, pattern) as Fact[];
  }
  return db
    .prepare(
      `SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
       FROM facts
       WHERE content LIKE ? OR subject LIKE ? OR category LIKE ?
       ORDER BY updated_at DESC
       LIMIT 6`
    )
    .all(pattern, pattern, pattern) as Fact[];
}

/**
 * Get all facts for a given category.
 */
export function getFactsByCategory(db: Database.Database, category: string): Fact[] {
  const stmt = db.prepare(`
      SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
      FROM facts
      WHERE category = ?
      ORDER BY subject, updated_at DESC
    `);
  return stmt.all(category) as Fact[];
}

/**
 * Get a list of distinct fact categories.
 */
export function getFactCategories(db: Database.Database): string[] {
  const stmt = db.prepare(`
      SELECT DISTINCT category FROM facts ORDER BY category
    `);
  const rows = stmt.all() as { category: string }[];
  return rows.map((r) => r.category);
}

// ============ Importance decay ============

/**
 * Decay importance for facts not accessed recently.
 * Run at app startup to gradually demote stale facts.
 *
 * - Facts not accessed in 30+ days: importance -= 10 (min 10)
 * - Facts not accessed in 90+ days: importance -= 20 (min 5)
 */
export function decayFactImportance(db: Database.Database): void {
  // 90+ days first (larger decay), then 30+ days
  const decayed90 = db
    .prepare(
      `UPDATE facts
       SET importance = MAX(5, importance - 20)
       WHERE last_accessed_at IS NOT NULL
         AND last_accessed_at < datetime('now', '-90 days')
         AND importance > 5`
    )
    .run();

  const decayed30 = db
    .prepare(
      `UPDATE facts
       SET importance = MAX(10, importance - 10)
       WHERE last_accessed_at IS NOT NULL
         AND last_accessed_at < datetime('now', '-30 days')
         AND last_accessed_at >= datetime('now', '-90 days')
         AND importance > 10`
    )
    .run();

  const total = (decayed90.changes || 0) + (decayed30.changes || 0);
  if (total > 0) {
    console.log(
      `[Memory] Decayed importance for ${total} stale facts (90d: ${decayed90.changes}, 30d: ${decayed30.changes})`
    );
  }
}
