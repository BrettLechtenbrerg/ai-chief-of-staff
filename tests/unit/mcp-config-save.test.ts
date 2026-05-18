/**
 * Unit tests for `saveMCPConfig()` — the atomic-writer that the Settings
 * → Connections UI uses to persist changes to `mcp-servers.json`.
 *
 * Covers:
 *  - Round-trip: write → read produces the same shape.
 *  - Atomic write: tmp file gone on success, nothing torn on crash.
 *  - Validation: malformed input throws before touching disk.
 *  - Forward compatibility: unknown top-level + per-server fields are
 *    preserved across a save (so an older Settings UI doesn't wipe a
 *    field a future version added).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadMCPConfig, saveMCPConfig, resolveMCPConfigPath } from '../../src/mcp/config';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acos-mcp-save-'));
}

describe('saveMCPConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a config file that loadMCPConfig can read back', () => {
    saveMCPConfig(dir, {
      mcpServers: {
        flo: { command: 'node', args: ['server.js'], env: { TOKEN: 'abc' } },
        other: { command: 'npx', args: ['-y', '@example/server'] },
      },
    });

    const reloaded = loadMCPConfig(dir);
    expect(Object.keys(reloaded.mcpServers).sort()).toEqual(['flo', 'other']);
    expect(reloaded.mcpServers.flo.command).toBe('node');
    expect(reloaded.mcpServers.flo.args).toEqual(['server.js']);
    expect(reloaded.mcpServers.flo.env).toEqual({ TOKEN: 'abc' });
    expect(reloaded.mcpServers.other.args).toEqual(['-y', '@example/server']);
  });

  it('does NOT leave a .tmp file on success', () => {
    saveMCPConfig(dir, { mcpServers: { x: { command: 'echo' } } });
    const configPath = resolveMCPConfigPath(dir);
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(`${configPath}.tmp`)).toBe(false);
  });

  it('rejects malformed input WITHOUT touching the existing file', () => {
    // First write a known-good file.
    saveMCPConfig(dir, { mcpServers: { good: { command: 'echo' } } });
    const configPath = resolveMCPConfigPath(dir);
    const before = fs.readFileSync(configPath, 'utf8');

    // Missing command — should throw.
    expect(() =>
      saveMCPConfig(dir, {
        mcpServers: { bad: { command: '' } as never },
      }),
    ).toThrow(/command/);

    // Wrong type for args.
    expect(() =>
      saveMCPConfig(dir, {
        mcpServers: { bad: { command: 'x', args: 'not-an-array' as never } },
      }),
    ).toThrow(/args/);

    // Wrong shape for env.
    expect(() =>
      saveMCPConfig(dir, {
        mcpServers: { bad: { command: 'x', env: ['nope'] as never } },
      }),
    ).toThrow(/env/);

    // Bad top-level shape.
    expect(() => saveMCPConfig(dir, null as never)).toThrow();
    expect(() => saveMCPConfig(dir, { mcpServers: null } as never)).toThrow();

    // The on-disk file should be unchanged.
    const after = fs.readFileSync(configPath, 'utf8');
    expect(after).toBe(before);
  });

  it('preserves unknown top-level fields across a save (forward compat)', () => {
    const configPath = resolveMCPConfigPath(dir);

    // Hand-craft a file with an unknown top-level key (simulating a future
    // ACOS version that added e.g. a "globalDefaults" block).
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: { keepme: { command: 'echo' } },
        globalDefaults: { timeout: 30000 },
      }),
    );

    // Older Settings UI re-saves without knowing about globalDefaults.
    saveMCPConfig(dir, { mcpServers: { keepme: { command: 'echo' } } });

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(raw.globalDefaults).toEqual({ timeout: 30000 });
    expect(raw.mcpServers.keepme.command).toBe('echo');
  });

  it('preserves unknown per-server fields across a save (forward compat)', () => {
    const configPath = resolveMCPConfigPath(dir);

    // A future field on a server entry.
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          flo: {
            command: 'node',
            args: ['s.js'],
            // hypothetical future field — older code doesn't know about it
            startupTimeoutMs: 5000,
          },
        },
      }),
    );

    // Old code saves the entry with only known fields; the unknown one
    // should still be on disk afterwards.
    saveMCPConfig(dir, {
      mcpServers: {
        flo: { command: 'node', args: ['s.js', '--verbose'] },
      },
    });

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(raw.mcpServers.flo.startupTimeoutMs).toBe(5000);
    expect(raw.mcpServers.flo.args).toEqual(['s.js', '--verbose']);
  });

  it('drops unknown per-server fields for servers that are being deleted', () => {
    const configPath = resolveMCPConfigPath(dir);

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          deleteme: { command: 'old', futureField: 'gone' },
          keepme: { command: 'new' },
        },
      }),
    );

    // Save without "deleteme" — the whole entry plus its unknown field
    // should be gone.
    saveMCPConfig(dir, {
      mcpServers: { keepme: { command: 'new' } },
    });

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(raw.mcpServers.deleteme).toBeUndefined();
    expect(raw.mcpServers.keepme.command).toBe('new');
  });

  it('overwrites known fields with the new values', () => {
    saveMCPConfig(dir, {
      mcpServers: { x: { command: 'old', args: ['a'], env: { K: 'v1' } } },
    });
    saveMCPConfig(dir, {
      mcpServers: { x: { command: 'new', args: ['b', 'c'], env: { K: 'v2' } } },
    });

    const reloaded = loadMCPConfig(dir);
    expect(reloaded.mcpServers.x.command).toBe('new');
    expect(reloaded.mcpServers.x.args).toEqual(['b', 'c']);
    expect(reloaded.mcpServers.x.env).toEqual({ K: 'v2' });
  });

  it('creates the userData directory if it does not exist', () => {
    const nested = path.join(dir, 'sub', 'nested');
    expect(fs.existsSync(nested)).toBe(false);

    saveMCPConfig(nested, { mcpServers: { x: { command: 'echo' } } });

    expect(fs.existsSync(resolveMCPConfigPath(nested))).toBe(true);
  });
});
