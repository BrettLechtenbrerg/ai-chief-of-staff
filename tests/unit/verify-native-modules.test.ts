import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const verifier = require('../../scripts/verify-native-modules.cjs') as {
  describe(buffer: Buffer): { kind: string; machine?: number };
  checkAgainst(
    info: { kind: string; machine?: number },
    platform: string,
    arch: string
  ): string | null;
};

function fixture(name: string): Buffer {
  const hex = fs.readFileSync(
    path.join(process.cwd(), 'tests/fixtures/native-modules', name),
    'utf8'
  );
  return Buffer.from(hex.trim(), 'hex');
}

describe('verify-native-modules Windows PE architecture', () => {
  it('reads the COFF machine field instead of trusting MZ magic', () => {
    expect(verifier.describe(fixture('windows-x64.hex'))).toEqual({
      kind: 'pe',
      machine: 0x8664,
    });
    expect(verifier.describe(fixture('windows-arm64.hex'))).toEqual({
      kind: 'pe',
      machine: 0xaa64,
    });
  });

  it('rejects ARM64 native modules in x64 packages and vice versa', () => {
    const x64 = verifier.describe(fixture('windows-x64.hex'));
    const arm64 = verifier.describe(fixture('windows-arm64.hex'));
    expect(verifier.checkAgainst(x64, 'win32', 'x64')).toBeNull();
    expect(verifier.checkAgainst(arm64, 'win32', 'arm64')).toBeNull();
    expect(verifier.checkAgainst(arm64, 'win32', 'x64')).toContain(
      'expected Windows PE x64, found Windows PE arm64'
    );
    expect(verifier.checkAgainst(x64, 'win32', 'arm64')).toContain(
      'expected Windows PE arm64, found Windows PE x64'
    );
  });

  it('rejects malformed MZ files without a PE signature', () => {
    const malformed = Buffer.alloc(128);
    malformed.write('MZ');
    malformed.writeUInt32LE(0x40, 0x3c);
    const info = verifier.describe(malformed);
    expect(info.kind).toBe('pe-invalid');
    expect(verifier.checkAgainst(info, 'win32', 'x64')).toContain('PE-INVALID');
  });
});
