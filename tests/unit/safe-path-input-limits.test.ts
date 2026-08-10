import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decodeBoundedAttachment,
  getValidatedBase64ByteLength,
  MAX_ATTACHMENT_BYTES,
} from '../../src/utils/input-limits.js';
import {
  isPathWithin,
  resolveExistingPathWithin,
  resolvePathForCreateWithin,
} from '../../src/utils/safe-path.js';

let root: string;
let allowed: string;
let sibling: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-safe-path-'));
  allowed = path.join(root, 'AI Chief of Staff');
  sibling = path.join(root, 'AI Chief of Staff-evil');
  fs.mkdirSync(allowed);
  fs.mkdirSync(sibling);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('canonical path containment', () => {
  it('allows real children but rejects traversal and prefix-matching siblings', () => {
    const validFile = path.join(allowed, 'safe.txt');
    const siblingFile = path.join(sibling, 'stolen.txt');
    fs.writeFileSync(validFile, 'safe');
    fs.writeFileSync(siblingFile, 'stolen');

    expect(resolveExistingPathWithin(allowed, validFile)).toBe(fs.realpathSync(validFile));
    expect(() => resolveExistingPathWithin(allowed, siblingFile)).toThrow(/outside/i);
    expect(() => resolveExistingPathWithin(allowed, path.join(allowed, '..', 'AI Chief of Staff-evil', 'stolen.txt'))).toThrow(/outside/i);
    expect(isPathWithin(allowed, siblingFile)).toBe(false);
  });

  it('rejects directory symlinks and existing target symlinks that escape', () => {
    const outsideFile = path.join(sibling, 'secret.txt');
    fs.writeFileSync(outsideFile, 'secret');
    const linkedDirectory = path.join(allowed, 'linked');
    fs.symlinkSync(sibling, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => resolveExistingPathWithin(allowed, path.join(linkedDirectory, 'secret.txt'))).toThrow(
      /outside/i
    );
    expect(() => resolvePathForCreateWithin(allowed, path.join(linkedDirectory, 'new.txt'))).toThrow(
      /outside/i
    );
  });

  it('resolves safe new direct children', () => {
    expect(resolvePathForCreateWithin(allowed, path.join(allowed, 'new.txt'))).toBe(
      path.join(fs.realpathSync(allowed), 'new.txt')
    );
  });
});

describe('bounded attachment input', () => {
  it('decodes valid allowed data URLs', () => {
    const encoded = Buffer.from('hello').toString('base64');
    const result = decodeBoundedAttachment('notes.txt', `data:text/plain;base64,${encoded}`);
    expect(result.bytes.toString()).toBe('hello');
    expect(result.safeName).toBe('notes.txt');
    expect(getValidatedBase64ByteLength(encoded, 10)).toBe(5);
  });

  it('rejects unsupported names, MIME types, malformed base64, and oversized payloads', () => {
    expect(() => decodeBoundedAttachment('malware.exe', 'data:application/octet-stream;base64,WA==')).toThrow(
      /type/i
    );
    expect(() => decodeBoundedAttachment('image.png', 'data:video/mp4;base64,WA==')).toThrow(/MIME/i);
    expect(() => decodeBoundedAttachment('image.png', 'data:image/png;base64,not base64')).toThrow(
      /data URL/i
    );
    expect(() =>
      decodeBoundedAttachment(
        'large.pdf',
        `data:application/pdf;base64,${'A'.repeat(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1025)}`
      )
    ).toThrow(/10 MB/i);
  });

  it('keeps remote image downloads out of the privileged process', () => {
    const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
    const source = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/misc-ipc.ts'), 'utf8');
    expect(source).not.toMatch(/fetch\(src\)/);
    expect(source).not.toMatch(/resolvedPath\.startsWith/);
  });
});
