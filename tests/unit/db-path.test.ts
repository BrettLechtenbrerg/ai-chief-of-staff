import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fs is mocked so we can control which paths "exist"
vi.mock('fs', () => ({
  default: { existsSync: vi.fn() },
  existsSync: vi.fn(),
}));

// path must use real join so the produced strings are correct
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual };
});

import * as fs from 'fs';
import path from 'path';
import { getDbPath, getDbCandidates } from '../../src/utils/db-path';

const mockExistsSync = vi.mocked(fs.existsSync);
const normalizePath = (value: string): string => value.replaceAll(path.sep, '/');

describe('getDbCandidates', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    process.env.HOME = '/home/testuser';
    process.env.USERPROFILE = 'C:\\Users\\testuser';
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  });

  it('returns four candidate paths', () => {
    // May 17, 2026: getDbCandidates now returns 4 paths — the canonical
    // lowercase-slug macOS path (matches package.json `name`), a Title Case
    // legacy/fallback path, Linux, and Windows.
    const candidates = getDbCandidates();
    expect(candidates).toHaveLength(4);
  });

  it('canonical macOS path uses lowercase slug (matches package.json name)', () => {
    const candidates = getDbCandidates().map(normalizePath);
    expect(candidates[0]).toContain('Library/Application Support/ai-chief-of-staff/ai-chief-of-staff.db');
    expect(candidates[0]).toContain('/home/testuser');
  });

  it('legacy macOS path uses Title Case productName as fallback', () => {
    const candidates = getDbCandidates().map(normalizePath);
    expect(candidates[1]).toContain('Library/Application Support/AI Chief of Staff/ai-chief-of-staff.db');
    expect(candidates[1]).toContain('/home/testuser');
  });

  it('Linux path uses HOME and .config', () => {
    const candidates = getDbCandidates().map(normalizePath);
    expect(candidates[2]).toContain('.config/ai-chief-of-staff/ai-chief-of-staff.db');
    expect(candidates[2]).toContain('/home/testuser');
  });

  it('Windows path uses USERPROFILE and AppData/Roaming', () => {
    const candidates = getDbCandidates().map(normalizePath);
    expect(candidates[3]).toContain('AppData/Roaming/ai-chief-of-staff/ai-chief-of-staff.db');
  });
});

describe('getDbPath', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    process.env.HOME = '/home/testuser';
    process.env.USERPROFILE = 'C:\\Users\\testuser';
    mockExistsSync.mockReset();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  });

  it('returns the first existing path (canonical macOS lowercase slug)', () => {
    // Only the canonical macOS lowercase-slug path exists
    mockExistsSync.mockImplementation((candidatePath) =>
      normalizePath(String(candidatePath)).includes('Library/Application Support/ai-chief-of-staff')
    );

    const result = normalizePath(getDbPath());
    expect(result).toContain('Library/Application Support/ai-chief-of-staff/ai-chief-of-staff.db');
  });

  it('skips macOS path and returns Linux path when only Linux path exists', () => {
    mockExistsSync.mockImplementation((candidatePath) =>
      normalizePath(String(candidatePath)).includes('.config/ai-chief-of-staff')
    );

    const result = normalizePath(getDbPath());
    expect(result).toContain('.config/ai-chief-of-staff/ai-chief-of-staff.db');
  });

  it('skips macOS and Linux paths and returns Windows path when only Windows path exists', () => {
    mockExistsSync.mockImplementation((candidatePath) =>
      normalizePath(String(candidatePath)).includes('AppData/Roaming')
    );

    const result = normalizePath(getDbPath());
    expect(result).toContain('AppData/Roaming/ai-chief-of-staff/ai-chief-of-staff.db');
  });

  it('falls back to canonical macOS path (candidates[0]) when no path exists', () => {
    mockExistsSync.mockReturnValue(false);

    const result = getDbPath();
    const candidates = getDbCandidates();
    expect(result).toBe(candidates[0]);
    expect(normalizePath(result)).toContain('Library/Application Support/ai-chief-of-staff/ai-chief-of-staff.db');
  });

  it('returns canonical macOS path when multiple paths exist (first match wins)', () => {
    // All paths "exist" — should still return the first one (lowercase slug)
    mockExistsSync.mockReturnValue(true);

    const result = normalizePath(getDbPath());
    expect(result).toContain('Library/Application Support/ai-chief-of-staff/ai-chief-of-staff.db');
  });
});
