import Database from 'better-sqlite3';

/**
 * A Brand is a named profile that owns its own brand book. It powers
 * multi-brand Content Writer / SEO: a session can target a specific brand
 * via `sessions.brand_id`, and the chat engine injects that brand's
 * Brand & Style / Writing Rules / About-My-Business into the system prompt.
 *
 * Exactly one brand is the default (`is_default = 1`); it's used whenever a
 * session has no explicit brand. The default-brand invariant is enforced by
 * createBrand (first brand wins) and setDefaultBrand (clears the rest).
 */
export interface Brand {
  id: string;
  name: string;
  slug: string;
  brand_style: string;
  writing_rules: string;
  business: string;
  site_url: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface BrandRow {
  id: string;
  name: string;
  slug: string;
  brand_style: string | null;
  writing_rules: string | null;
  business: string | null;
  site_url: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface BrandInput {
  name: string;
  slug?: string;
  brand_style?: string;
  writing_rules?: string;
  business?: string;
  site_url?: string;
  is_default?: boolean;
}

export interface BrandUpdate {
  name?: string;
  slug?: string;
  brand_style?: string;
  writing_rules?: string;
  business?: string;
  site_url?: string;
}

function rowToBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    brand_style: row.brand_style ?? '',
    writing_rules: row.writing_rules ?? '',
    business: row.business ?? '',
    site_url: row.site_url ?? '',
    is_default: !!row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Normalize an arbitrary name into a url-safe slug (lowercase, hyphenated).
 * Falls back to 'brand' if the name has no slug-able characters.
 */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'brand';
}

/**
 * Ensure a slug is unique among brands, suffixing -2, -3, ... if needed.
 * Excludes `excludeId` so updating a brand to its own slug is allowed.
 */
function uniqueSlug(db: Database.Database, base: string, excludeId?: string): string {
  let slug = base;
  let suffix = 2;
  while (true) {
    const existing = db.prepare('SELECT id FROM brands WHERE slug = ?').get(slug) as
      | { id: string }
      | undefined;
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${suffix++}`;
  }
}

/**
 * List all brands, default brand first, then alphabetical by name.
 */
export function listBrands(db: Database.Database): Brand[] {
  const rows = db
    .prepare(
      `SELECT id, name, slug, brand_style, writing_rules, business, site_url, is_default, created_at, updated_at
       FROM brands
       ORDER BY is_default DESC, name COLLATE NOCASE ASC`
    )
    .all() as BrandRow[];
  return rows.map(rowToBrand);
}

/**
 * Get a brand by id.
 */
export function getBrand(db: Database.Database, id: string): Brand | null {
  const row = db
    .prepare(
      `SELECT id, name, slug, brand_style, writing_rules, business, site_url, is_default, created_at, updated_at
       FROM brands WHERE id = ?`
    )
    .get(id) as BrandRow | undefined;
  return row ? rowToBrand(row) : null;
}

/**
 * Get the default brand (is_default = 1), or null if none exists yet.
 */
export function getDefaultBrand(db: Database.Database): Brand | null {
  const row = db
    .prepare(
      `SELECT id, name, slug, brand_style, writing_rules, business, site_url, is_default, created_at, updated_at
       FROM brands WHERE is_default = 1 LIMIT 1`
    )
    .get() as BrandRow | undefined;
  return row ? rowToBrand(row) : null;
}

/**
 * Create a new brand. The very first brand created is automatically the
 * default; otherwise `is_default` honors the input (and clears the others
 * when true), keeping the single-default invariant.
 * @throws Error if name is blank or slug collides after normalization (shouldn't, slug is auto-uniqued)
 */
export function createBrand(db: Database.Database, input: BrandInput): Brand {
  const name = input.name?.trim();
  if (!name) {
    throw new Error('Brand name is required');
  }

  const count = (db.prepare('SELECT COUNT(*) as c FROM brands').get() as { c: number }).c;
  const baseSlug = slugify(input.slug?.trim() || name);
  const slug = uniqueSlug(db, baseSlug);

  // First brand is always default; otherwise honor the requested flag.
  const isDefault = count === 0 ? true : !!input.is_default;

  const id = `brand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const tx = db.transaction(() => {
    if (isDefault) {
      db.prepare('UPDATE brands SET is_default = 0').run();
    }
    db.prepare(
      `INSERT INTO brands
         (id, name, slug, brand_style, writing_rules, business, site_url, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')), (strftime('%Y-%m-%dT%H:%M:%fZ')))`
    ).run(
      id,
      name,
      slug,
      input.brand_style ?? '',
      input.writing_rules ?? '',
      input.business ?? '',
      input.site_url ?? '',
      isDefault ? 1 : 0
    );
  });
  tx();

  return getBrand(db, id)!;
}

/**
 * Update a brand's editable fields. Does not change default status
 * (use setDefaultBrand for that). Slug, if changed, is re-uniqued.
 */
export function updateBrand(db: Database.Database, id: string, update: BrandUpdate): Brand | null {
  const existing = getBrand(db, id);
  if (!existing) return null;

  const name = update.name !== undefined ? update.name.trim() || existing.name : existing.name;
  // Slug only changes on an explicit slug edit; renaming keeps the slug stable
  // so external references (and the SEO property mapping) don't break.
  let slug = existing.slug;
  if (update.slug !== undefined) {
    slug = uniqueSlug(db, slugify(update.slug.trim() || name), id);
  }

  db.prepare(
    `UPDATE brands SET
       name = ?, slug = ?, brand_style = ?, writing_rules = ?, business = ?, site_url = ?,
       updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
     WHERE id = ?`
  ).run(
    name,
    slug,
    update.brand_style ?? existing.brand_style,
    update.writing_rules ?? existing.writing_rules,
    update.business ?? existing.business,
    update.site_url ?? existing.site_url,
    id
  );

  return getBrand(db, id);
}

/**
 * Delete a brand. Clears `brand_id` on any sessions that pointed at it (so
 * they fall back to the default brand). If the deleted brand was the default
 * and other brands remain, the most-recently-updated one is promoted to
 * default — there is always a default while any brand exists.
 * @throws Error if it is the only remaining brand (the app needs at least one).
 */
export function deleteBrand(db: Database.Database, id: string): boolean {
  const target = getBrand(db, id);
  if (!target) return false;

  const count = (db.prepare('SELECT COUNT(*) as c FROM brands').get() as { c: number }).c;
  if (count <= 1) {
    throw new Error('Cannot delete the last brand');
  }

  const tx = db.transaction(() => {
    // Unlink sessions pointing at this brand so they revert to the default.
    db.prepare('UPDATE sessions SET brand_id = NULL WHERE brand_id = ?').run(id);
    db.prepare('DELETE FROM brands WHERE id = ?').run(id);

    // Promote a new default if we just removed it.
    if (target.is_default) {
      const next = db
        .prepare('SELECT id FROM brands ORDER BY updated_at DESC LIMIT 1')
        .get() as { id: string } | undefined;
      if (next) {
        db.prepare('UPDATE brands SET is_default = 1 WHERE id = ?').run(next.id);
      }
    }
  });
  tx();

  return true;
}

/**
 * Make a brand the default, clearing the flag on all others.
 */
export function setDefaultBrand(db: Database.Database, id: string): boolean {
  const existing = getBrand(db, id);
  if (!existing) return false;

  const tx = db.transaction(() => {
    db.prepare('UPDATE brands SET is_default = 0').run();
    db.prepare(
      `UPDATE brands SET is_default = 1, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?`
    ).run(id);
  });
  tx();

  return true;
}

/**
 * Resolve the brand to use for a context: the explicit brand if it exists,
 * else the default brand, else null. Centralizes the selected→default
 * fallback used by both the chat engine and the SEO tool.
 */
export function resolveBrand(db: Database.Database, brandId?: string | null): Brand | null {
  if (brandId) {
    const explicit = getBrand(db, brandId);
    if (explicit) return explicit;
  }
  return getDefaultBrand(db);
}
