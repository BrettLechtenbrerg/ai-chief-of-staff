/**
 * Tests for facts.ts fixes:
 * - searchFacts LIMIT (bounded results)
 * - FTS5 escaping (special characters stripped)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock embeddings (required by MemoryManager)
vi.mock('../../src/memory/embeddings', () => ({
  initEmbeddings: vi.fn(),
  hasEmbeddings: vi.fn(() => false),
  embed: vi.fn(),
  cosineSimilarity: vi.fn(),
  serializeEmbedding: vi.fn(),
  deserializeEmbedding: vi.fn(),
}));

import { MemoryManager } from '../../src/memory/index';

describe('Facts Fixes', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager(':memory:');
  });

  afterEach(() => {
    memory?.close();
  });

  describe('searchFacts LIMIT', () => {
    it('should return bounded results (not unbounded)', () => {
      // Insert more facts than MAX_SEARCH_RESULTS (6)
      for (let i = 0; i < 20; i++) {
        memory.saveFact('test', `subject-${i}`, `test content item ${i}`);
      }

      const results = memory.searchFacts('test');
      // Should be capped at MAX_SEARCH_RESULTS (6), not all 20
      expect(results.length).toBeLessThanOrEqual(6);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return bounded results with category filter', () => {
      for (let i = 0; i < 20; i++) {
        memory.saveFact('mycat', `subject-${i}`, `findme content item ${i}`);
      }

      const results = memory.searchFacts('findme', 'mycat');
      expect(results.length).toBeLessThanOrEqual(6);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('FTS5 escaping', () => {
    it('should handle FTS5 special characters without crashing', () => {
      memory.saveFact('test', 'name', 'hello world');

      // These contain FTS5 operators that would crash without proper escaping
      const specialQueries = [
        'hello* OR NOT world',
        'test) OR (category:*',
        'NEAR(hello, world)',
        'hello AND NOT test',
        '"quoted phrase"',
        'hello ^ world',
        'category:test',
      ];

      for (const query of specialQueries) {
        expect(() => memory.searchFacts(query)).not.toThrow();
      }
    });

    it('should still find results with plain text query', () => {
      memory.saveFact('test', 'greeting', 'hello world');

      // searchFacts uses LIKE — plain text matches fine
      const results = memory.searchFacts('hello');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toBe('hello world');
    });

    it('should handle query that is entirely special characters', () => {
      memory.saveFact('test', 'name', 'hello');

      // After stripping, query becomes empty — should not crash
      expect(() => memory.searchFacts('***')).not.toThrow();
      expect(() => memory.searchFacts('^():')).not.toThrow();
    });
  });
});
