import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

it('compiles a CommonJS preload without overwriting its type-only ESM dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'acos-preload-build-'));
  const compiler = resolve('node_modules/typescript/bin/tsc');
  try {
    mkdirSync(join(root, 'src/main'), { recursive: true });
    mkdirSync(join(root, 'src/tools'), { recursive: true });
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(root, 'src/tools/shared.ts'), 'export interface Input { count: number }; export function readCount() { return 42; }');
    writeFileSync(join(root, 'src/main/preload.ts'), "import type { Input } from '../tools/shared'; export const input: Input = { count: 1 };");
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'ES2022', target: 'ES2022', rootDir: 'src', outDir: 'dist', declaration: true, declarationMap: true, sourceMap: true, skipLibCheck: true }, include: ['src/**/*'] }));
    copyFileSync(resolve('tsconfig.preload.json'), join(root, 'tsconfig.preload.json'));
    copyFileSync(resolve('scripts/fix-esm-imports.cjs'), join(root, 'scripts/fix-esm-imports.cjs'));
    const run = (args: string[]) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 15000 });
    run([compiler, '-p', 'tsconfig.json']);
    const shared = readFileSync(join(root, 'dist/tools/shared.js'), 'utf8');
    run([compiler, '-p', 'tsconfig.preload.json']);
    expect(readFileSync(join(root, 'dist/tools/shared.js'), 'utf8')).toBe(shared);
    run(['scripts/fix-esm-imports.cjs']);
    expect(readFileSync(join(root, 'dist/main/preload.js'), 'utf8')).toContain('exports.input');
    expect(run(['--input-type=module', '-e', "import { readCount } from './dist/tools/shared.js'; console.log(readCount());"]).trim()).toBe('42');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 40000);
