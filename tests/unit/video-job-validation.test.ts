import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const localRequire = createRequire(import.meta.url);
const worker: {
  validatePreset(props: unknown): number;
  digestTree(root: string): Promise<string>;
  verifyEncodedMetadata(actual: unknown, expected: unknown): Record<string, number>;
} = localRequire('../../assets/skills/remotion/video-job.cjs');
const captions: { captionChunks(text: string): string[]; makeSrt(text: string, frames: number, fps: number): string } = localRequire('../../assets/skills/remotion/captions.cjs');
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-video-validate-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const expected = { width: 1080, height: 1080, fps: 30, durationInFrames: 90 };
const actual = { dimensions: { width: 1080, height: 1080 }, fps: 30, slowNumberOfFrames: 90, durationInSeconds: 3.051 };
const props = () => ({ durationSeconds: 10, elements: { caption: 'A useful contrast', verbal: 'Keep these words exactly.', visual: 'Simple typography', text: 'Useful ideas', audio: 'Silent draft' } });

describe('Real video validation and deterministic caption helpers', () => {
  it('requires exact video frame counts while exposing AAC container padding separately', () => {
    expect(worker.verifyEncodedMetadata(actual, expected)).toEqual({ durationInSeconds: 3, containerDurationInSeconds: 3.051, fps: 30 });
    expect(() => worker.verifyEncodedMetadata({ ...actual, slowNumberOfFrames: 89 }, expected)).toThrow();
  });
  it.each([
    { dimensions: { width: 1920, height: 1080 } }, { fps: 60 }, { fps: NaN },
    { durationInSeconds: null }, { durationInSeconds: 4 }, { slowNumberOfFrames: 91 },
  ])('rejects incorrect or unavailable encoded measurements: %j', patch => {
    expect(() => worker.verifyEncodedMetadata({ ...actual, ...patch }, expected)).toThrow();
  });
  it('detects changed bundle content, paths and symlinks using actual temporary files', async () => {
    fs.writeFileSync(path.join(root, 'a'), 'first');
    const before = await worker.digestTree(root);
    fs.writeFileSync(path.join(root, 'a'), 'second');
    const changed = await worker.digestTree(root); expect(changed).not.toBe(before);
    fs.renameSync(path.join(root, 'a'), path.join(root, 'b'));
    const renamed = await worker.digestTree(root); expect(renamed).not.toBe(changed);
    fs.symlinkSync(path.join(root, 'b'), path.join(root, 'link'));
    await expect(worker.digestTree(root)).rejects.toThrow('symlink');
  });
  it('retains every character when caption chunks are combined', () => {
    const text = '  Exact words, <literal> text.\n' + ' Keep punctuation! '.repeat(20);
    expect(captions.captionChunks(text).join('')).toBe(text);
    const srt = captions.makeSrt(text, 900, 30);
    expect(srt).toContain('00:00:30,000'); expect(srt).toContain('&lt;literal&gt;');
    expect(srt).not.toContain('<literal>');
  });
  it('accepts the bounded preset without inventing or shortening any selection', () => {
    const input = props(); const before = JSON.stringify(input);
    expect(worker.validatePreset(input)).toBe(10); expect(JSON.stringify(input)).toBe(before);
  });
  it('rejects unreadable colors, overlong overlays, missing elements and excessive speech rate', () => {
    expect(() => worker.validatePreset({ ...props(), background: '#ffffff', foreground: '#eeeeee' })).toThrow('contrast');
    const long = props(); long.elements.text = 'x'.repeat(161);
    expect(() => worker.validatePreset(long)).toThrow('safe-area');
    const fast = props(); fast.durationSeconds = 1;
    expect(() => worker.validatePreset(fast)).toThrow('150 WPM');
    expect(() => worker.validatePreset({ elements: {} })).toThrow();
  });
});
