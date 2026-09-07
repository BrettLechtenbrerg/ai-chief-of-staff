import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { runVideoJobProcess } from '../../src/tools/video-job-process';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-video-process-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
function script(source: string): string {
  const file = path.join(root, 'inert.cjs'); fs.writeFileSync(file, source); return file;
}

describe('Owned video process lifetime (inert local Node children)', () => {
  it('reports real stages and drains private stderr without forwarding it', async () => {
    const progress: string[] = [];
    const file = script(`console.error('synthetic-private-output'); console.log('ACOS_VIDEO '+JSON.stringify({stage:'rendering',percent:25}));`);
    expect(await runVideoJobProcess(file, root, root, { onProgress: value => progress.push(value) })).toEqual({ ok: true, cancelled: false });
    expect(progress).toEqual(['rendering 25%']);
  });
  it('rejects before spawning an already-cancelled job', async () => {
    const c = new AbortController(); c.abort();
    await expect(runVideoJobProcess('/must-not-exist', root, root, { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('cancels detached descendants without killing an unrelated process', async () => {
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    const c = new AbortController();
    const file = script(`
      const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
      const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','ignore']});
      child.stdout.once('data',()=>{fs.writeFileSync(path.join(process.argv[3],'owned.json'),JSON.stringify({worker:process.pid,child:child.pid})); console.log('ACOS_VIDEO '+JSON.stringify({stage:'rendering',percent:1}));});
      process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
    `);
    try {
      const result = await runVideoJobProcess(file, root, root, { signal: c.signal, onProgress: () => c.abort(), timeoutMs: 6000 });
      expect(result).toEqual({ ok: false, cancelled: true });
      const owned = JSON.parse(fs.readFileSync(path.join(root, 'owned.json'), 'utf8')) as { worker: number; child: number };
      const table = execFileSync('/bin/ps', ['-axo', 'pid=,stat='], { encoding: 'utf8' });
      for (const pid of [owned.worker, owned.child]) {
        const row = table.split('\n').find(line => Number(line.trim().split(/\s+/)[0]) === pid);
        expect(row).toBeUndefined();
      }
      expect(() => process.kill(sentinel.pid!, 0)).not.toThrow();
    } finally {
      // A failed assertion must not leave this test's deliberately stubborn child.
      const record = path.join(root, 'owned.json');
      if (fs.existsSync(record)) {
        const owned = JSON.parse(fs.readFileSync(record, 'utf8')) as { worker: number; child: number };
        for (const pid of [owned.worker, owned.child]) {
          try { process.kill(-pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
      }
      const closed = new Promise<void>(resolve => sentinel.once('close', () => resolve())); sentinel.kill('SIGTERM'); await closed;
    }
  }, 10000);
  it('times out an unresponsive owned process', async () => {
    const file = script(`process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
    expect(await runVideoJobProcess(file, root, root, { timeoutMs: 100 })).toEqual({ ok: false, cancelled: true });
  }, 5000);
});
