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
import { getDbPath, getDbCandidates } from '../../src/utils/db-path';

const mockExistsSync = vi.mocked(fs.existsSync);

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

  it('returns three candidate paths', () => {
    const candidates = getDbCandidates();
    expect(candidates).toHaveLength(3);
  });

  it('macOS path uses HOME and Library/Application Support', () => {
    const candidates = getDbCandidates();
    expect(candidates[0]).toContain('Library/Application Support/pocket-agent/pocket-agent.db');
    expect(candidates[0]).toContain('/home/testuser');
  });

  it('Linux path uses HOME and .config', () => {
    const candidates = getDbCandidates();
    expect(candidates[1]).toContain('.config/pocket-agent/pocket-agent.db');
    expect(candidates[1]).toContain('/home/testuser');
  });

  it('Windows path uses USERPROFILE and AppData/Roaming', () => {
    const candidates = getDbCandidates();
    expect(candidates[2]).toContain('AppData/Roaming/pocket-agent/pocket-agent.db');
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

  it('returns the first existing path (macOS)', () => {
    // Only the macOS path exists
    mockExistsSync.mockImplementation((p) =>
      String(p).includes('Library/Application Support')
    );

    const result = getDbPath();
    expect(result).toContain('Library/Application Support/pocket-agent/pocket-agent.db');
  });

  it('skips macOS path and returns Linux path when only Linux path exists', () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).includes('.config/pocket-agent')
    );

    const result = getDbPath();
    expect(result).toContain('.config/pocket-agent/pocket-agent.db');
  });

  it('skips macOS and Linux paths and returns Windows path when only Windows path exists', () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).includes('AppData/Roaming')
    );

    const result = getDbPath();
    expect(result).toContain('AppData/Roaming/pocket-agent/pocket-agent.db');
  });

  it('falls back to macOS path (candidates[0]) when no path exists', () => {
    mockExistsSync.mockReturnValue(false);

    const result = getDbPath();
    const candidates = getDbCandidates();
    expect(result).toBe(candidates[0]);
    expect(result).toContain('Library/Application Support/pocket-agent/pocket-agent.db');
  });

  it('returns macOS path when multiple paths exist (first match wins)', () => {
    // All paths "exist" — should still return the first one
    mockExistsSync.mockReturnValue(true);

    const result = getDbPath();
    expect(result).toContain('Library/Application Support/pocket-agent/pocket-agent.db');
  });
});
