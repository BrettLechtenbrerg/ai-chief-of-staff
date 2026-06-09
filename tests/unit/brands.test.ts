import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock embeddings before importing MemoryManager (same pattern as memory.test.ts).
vi.mock('../../src/memory/embeddings', () => ({
  initEmbeddings: vi.fn(),
  hasEmbeddings: vi.fn(() => false),
  embed: vi.fn(),
  cosineSimilarity: vi.fn(),
  serializeEmbedding: vi.fn(),
  deserializeEmbedding: vi.fn(),
}));

import Database from 'better-sqlite3';
import { MemoryManager } from '../../src/memory/index';

describe('Brands (multi-brand books)', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager(':memory:');
  });

  afterEach(() => {
    memory?.close();
  });

  describe('migration + seeding', () => {
    it('seeds exactly one default brand on a fresh DB', () => {
      const brands = memory.listBrands();
      expect(brands).toHaveLength(1);
      expect(brands[0].is_default).toBe(true);
    });

    it('default brand has empty book when no legacy keys exist', () => {
      const def = memory.getDefaultBrand();
      expect(def).not.toBeNull();
      expect(def!.brand_style).toBe('');
      expect(def!.writing_rules).toBe('');
      expect(def!.business).toBe('');
    });

    // Legacy-key backfill is covered against a shared on-disk DB at the bottom
    // of this file (a fresh :memory: DB has no settings table to seed from).
  });

  describe('CRUD', () => {
    it('creates a brand with an auto-generated unique slug', () => {
      const b = memory.createBrand({ name: 'TSAI' });
      expect(b.name).toBe('TSAI');
      expect(b.slug).toBe('tsai');
      expect(memory.listBrands()).toHaveLength(2);
    });

    it('enforces slug uniqueness by suffixing', () => {
      const a = memory.createBrand({ name: 'Acme Co' });
      const b = memory.createBrand({ name: 'Acme!!!Co' });
      expect(a.slug).toBe('acme-co');
      expect(b.slug).toBe('acme-co-2');
    });

    it('updates editable fields', () => {
      const b = memory.createBrand({ name: 'PMMA' });
      const updated = memory.updateBrand(b.id, {
        brand_style: 'Bold.',
        writing_rules: 'Short sentences.',
        business: 'Martial arts.',
      });
      expect(updated!.brand_style).toBe('Bold.');
      expect(updated!.writing_rules).toBe('Short sentences.');
      expect(updated!.business).toBe('Martial arts.');
    });

    it('getBrand returns null for an unknown id', () => {
      expect(memory.getBrand('nope')).toBeNull();
    });
  });

  describe('default-brand invariant', () => {
    it('first brand is automatically default', () => {
      // The seeded brand is default; create another non-default by default.
      const b = memory.createBrand({ name: 'Second' });
      expect(b.is_default).toBe(false);
      expect(memory.getDefaultBrand()!.id).not.toBe(b.id);
    });

    it('setDefaultBrand moves the flag exclusively', () => {
      const b = memory.createBrand({ name: 'TSAI' });
      memory.setDefaultBrand(b.id);
      const defaults = memory.listBrands().filter((x) => x.is_default);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(b.id);
    });

    it('creating with is_default=true clears the prior default', () => {
      const b = memory.createBrand({ name: 'New Default', is_default: true });
      const defaults = memory.listBrands().filter((x) => x.is_default);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(b.id);
    });

    it('refuses to delete the last brand', () => {
      const only = memory.listBrands();
      expect(only).toHaveLength(1);
      expect(() => memory.deleteBrand(only[0].id)).toThrow();
    });

    it('deleting the default promotes another brand to default', () => {
      const b = memory.createBrand({ name: 'TSAI' });
      const def = memory.getDefaultBrand()!;
      memory.deleteBrand(def.id);
      const remaining = memory.listBrands();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(b.id);
      expect(remaining[0].is_default).toBe(true);
    });
  });

  describe('resolveBrand', () => {
    it('returns the explicit brand when it exists', () => {
      const b = memory.createBrand({ name: 'TSAI' });
      expect(memory.resolveBrand(b.id)!.id).toBe(b.id);
    });

    it('falls back to the default brand for unknown/null id', () => {
      const def = memory.getDefaultBrand()!;
      expect(memory.resolveBrand(null)!.id).toBe(def.id);
      expect(memory.resolveBrand('does-not-exist')!.id).toBe(def.id);
    });
  });

  describe('session brand_id', () => {
    it('defaults to null and round-trips through set/get', () => {
      const session = memory.createSession('Brand Session');
      expect(memory.getSessionBrandId(session.id)).toBeNull();

      const b = memory.createBrand({ name: 'TSAI' });
      expect(memory.setSessionBrandId(session.id, b.id)).toBe(true);
      expect(memory.getSessionBrandId(session.id)).toBe(b.id);

      // Session object also carries brand_id.
      expect(memory.getSession(session.id)!.brand_id).toBe(b.id);

      // Clearing reverts to null (→ default brand).
      expect(memory.setSessionBrandId(session.id, null)).toBe(true);
      expect(memory.getSessionBrandId(session.id)).toBeNull();
    });

    it('clears brand_id on sessions when their brand is deleted', () => {
      const session = memory.createSession('Linked Session');
      const b = memory.createBrand({ name: 'TSAI' });
      memory.setSessionBrandId(session.id, b.id);

      memory.deleteBrand(b.id);
      expect(memory.getSessionBrandId(session.id)).toBeNull();
    });
  });
});

describe('Brands backfill from legacy settings (shared on-disk DB)', () => {
  it('seeds the default brand from personalize.* keys + profile.name (NOT the agent name)', async () => {
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brands-test-'));
    const dbPath = path.join(dir, 'shared.db');

    // Pre-create the settings table with legacy values (mimics SettingsManager
    // having initialized first against the same file).
    const setup = new Database(dbPath);
    setup.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted INTEGER DEFAULT 0,
        category TEXT DEFAULT 'general',
        updated_at TEXT
      );
    `);
    const ins = setup.prepare("INSERT INTO settings (key, value, encrypted) VALUES (?, ?, 0)");
    ins.run('personalize.brandStyle', 'Friendly and direct.');
    ins.run('personalize.writingRules', 'No em-dashes.');
    ins.run('personalize.business', 'AI consulting.');
    // The brand is named after the USER/business (profile.name), never the
    // assistant's name (personalize.agentName) — these are different concepts.
    ins.run('profile.name', 'Acme');
    ins.run('personalize.agentName', 'Zeus');
    setup.close();

    const memory = new MemoryManager(dbPath);
    try {
      const def = memory.getDefaultBrand();
      expect(def).not.toBeNull();
      expect(def!.name).toBe('Acme'); // profile.name, not the agent name 'Zeus'
      expect(def!.name).not.toBe('Zeus');
      expect(def!.slug).toBe('acme');
      expect(def!.brand_style).toBe('Friendly and direct.');
      expect(def!.writing_rules).toBe('No em-dashes.');
      expect(def!.business).toBe('AI consulting.');
      expect(def!.is_default).toBe(true);
    } finally {
      memory.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
