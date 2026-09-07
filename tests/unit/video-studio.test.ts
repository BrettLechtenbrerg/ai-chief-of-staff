import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(__dirname, '../..');
const hook = fs.readFileSync(path.join(root, 'ui/chat/hook-lab-panel.js'), 'utf8');
const video = fs.readFileSync(path.join(root, 'ui/chat/video-studio-panel.js'), 'utf8');
function harness() {
  const nodes = new Map<string, { value: string; textContent: string; disabled: boolean; classList: { add(): void; remove(): void }; closest(): null }>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false, classList: { add() {}, remove() {} }, closest: () => null });
    return nodes.get(id)!;
  };
  const storage = new Map<string, string>();
  const setBrand = vi.fn(async () => {});
  const send = vi.fn(async () => {});
  const context = vm.createContext({
    console, document: { getElementById: get, querySelector: () => null },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    window: { pocketAgent: {
      settings: { get: async () => '' }, brands: { list: async () => [{ id: 'b', name: 'Synthetic brand', is_default: true }] },
      videoStudio: { workspaceStatus: async () => ({ ready: true }) },
      sessions: { list: async () => [{ id: 'session', name: 'Video Studio' }], setBrand },
    } },
    sendMessage: send, setTimeout: (fn: () => void) => { fn(); return 1; },
    Notyf: class { success() {} error() {} },
  });
  vm.runInContext(hook, context); vm.runInContext(video, context);
  // Existing persisted Hook Lab schema: no extra fields or reconstructed names.
  const draft = { version: 1, id: 'saved', name: 'Selection', brandId: null,
    context: { platform: 'Shorts', audience: '', duration: '30', offer: '', evidence: '' },
    elements: { caption: 'Keep this post copy.', verbal: 'Exact spoken text\nwith a second line.', visual: '<img src=x onerror=alert(1)>', text: 'Exact overlay', audio: 'Silence — no invented sound' } };
  storage.set('hl-video-draft-v1', JSON.stringify(draft));
  return { context, get, storage, setBrand, send, draft, run: (code: string) => vm.runInContext(code, context) };
}

describe('Video Studio reviewed local handoff', () => {
  it('hands off all five exact fields, retains the draft, and clears inherited branding', async () => {
    const h = harness();
    await h.run('startVideoStudio()');
    expect(h.setBrand).toHaveBeenCalledExactlyOnceWith('session', null);
    expect(h.send).toHaveBeenCalledOnce();
    const prompt = h.get('message-input').value;
    const encoded = prompt.split('\n').find(line => line.startsWith('{"version":1,'));
    expect(JSON.parse(encoded!).elements).toEqual(h.draft.elements);
    expect(prompt).toContain('__VS_RENDER_PREVIEW__');
    expect(prompt).toContain('OMIT previewJobId');
    expect(prompt).not.toContain('npx remotion still');
    expect(h.storage.get('hl-video-draft-v1')).toBe(JSON.stringify(h.draft));
  });
  it('does not send a draft when its brand cannot be set', async () => {
    const h = harness(); h.setBrand.mockRejectedValueOnce(new Error('inert brand failure'));
    await h.run('startVideoStudio()');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.storage.has('hl-video-draft-v1')).toBe(true);
  });
  it('keeps invalid pending data and blocks kickoff instead of silently dropping it', async () => {
    const h = harness(); h.storage.set('hl-video-draft-v1', '{invalid');
    await h.run('startVideoStudio()');
    expect(h.setBrand).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    expect(h.storage.get('hl-video-draft-v1')).toBe('{invalid');
  });
  it('exposes the selected aspect on native keyboard-operable buttons', () => {
    const h = harness();
    const options = ['9:16', '16:9', '1:1'].map(aspect => ({
      dataset: { aspect }, classList: { toggle: vi.fn() }, setAttribute: vi.fn(),
    }));
    h.context.document.getElementById = () => ({ closest: () => null, querySelectorAll: () => options });
    h.run("_vsAspect = '16:9'; _vsRenderAspect()");
    for (const option of options) {
      expect(option.setAttribute).toHaveBeenCalledWith('aria-pressed', String(option.dataset.aspect === '16:9'));
    }
    const html = fs.readFileSync(path.join(root, 'ui/chat.html'), 'utf8');
    expect(html.match(/<button[^>]+class="vs-aspect-option"/g)).toHaveLength(3);
    expect(html).not.toContain('<div class="vs-aspect-option"');
  });
  it('recognizes preview review only as a terminal assistant marker', () => {
    const h = harness();
    expect(h.run('_VS_MARKER_REGEX.test("Plan\\n[[VS_STATE:preview_ready]]")')).toBe(true);
    expect(h.run('_VS_MARKER_REGEX.test("[[VS_STATE:preview_ready]] not a final marker")')).toBe(false);
    expect(h.run('_VS_MARKER_REGEX.test("[[VS_STATE:unknown]]")')).toBe(false);
  });
});
