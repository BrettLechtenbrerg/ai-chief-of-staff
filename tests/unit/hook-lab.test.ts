import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { URL } from 'node:url';

function harness(store = new Map<string, string>()) {
  const nodes = new Map();
  const node = () => ({ value: '', checked: false, disabled: false, textContent: '', children: [] as unknown[], className: '', listeners: {} as Record<string, () => void>, addEventListener(event: string, fn: () => void) { this.listeners[event] = fn; }, click() { if (!this.disabled) this.listeners.click?.(); }, appendChild(x: unknown) { this.children.push(x); }, replaceChildren() { this.children = []; }, set innerHTML(_: string) { throw Error('unsafe HTML'); } });
  const get = (id: string) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const context = vm.createContext({ console, crypto: { randomUUID: () => `id-${++seq}` }, document: { getElementById: get, createElement: node }, localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }, window: { confirm: () => true } });
  let seq = 0;
  for (const file of ['hook-lab-panel.js', 'video-studio-panel.js']) vm.runInContext(readFileSync(new URL('../../ui/chat/' + file, import.meta.url), 'utf8'), context);
  const run = (code: string) => vm.runInContext(code, context);
  run("_hlBrands = _vsBrands = [{id:'brand-a',name:'A'},{id:'brand-b',name:'B'}]; _hlPickedBrandId='brand-a'; showVideoStudioPanel = () => _vsReviewHookDraft();");
  get('hl-mode').value = 'full'; get('hl-duration').value = '30'; get('hl-rewrite-target').value = 'verbal'; get('hl-save-name').value = 'Same';
  for (const k of ['verbal', 'text', 'visual', 'audio', 'caption']) get('hl-selected-' + k).value = `${k}: “exact!”\n<img onerror=evil()> & 'punctuation'`;
  return { run, get, store };
}

describe('Hook Lab actual renderer contracts (synthetic storage only)', () => {
  it('defaults Full Lab to 25 options; Quick has 5; targeted has 1 without mutations', () => {
    const h = harness();
    const full = h.run("_hlBuildKickoffPrompt('idea')");
    for (const label of ['Verbal Hook', 'Text Overlay', 'Visual Hook', 'Audio Hook', 'Caption Hook']) expect(full).toContain('5 ' + label + ' options');
    h.get('hl-mode').value = 'quick'; expect(h.run("_hlBuildKickoffPrompt('idea')")).toContain('(5 total)');
    const before = h.run('JSON.stringify(_hlCurrent().elements)');
    h.get('hl-mode').value = 'rewrite';
    expect(h.run("_hlBuildKickoffPrompt('shorter')")).toContain('exactly 1 replacement for verbal');
    expect(h.run('JSON.stringify(_hlCurrent().elements)')).toBe(before);
  });
  it('reveals selected fields for targeted rewrites and exposes chosen goal state', () => {
    const h = harness();
    h.get('hl-mode').value = 'rewrite';
    h.run('_hlOnModeChange()');
    expect(h.get('hl-selection-details').open).toBe(true);
    h.run('_hlRenderChips()');
    expect(h.get('hl-goal-summary').textContent).toBe('Let Hook Lab infer');
    expect(h.get('hl-goal-chips').children[0].ariaPressed).toBe('false');
    h.get('hl-goal-chips').children[0].click();
    expect(h.get('hl-goal-summary').textContent).toBe('Get leads');
    expect(h.get('hl-goal-chips').children[0].ariaPressed).toBe('true');
    h.get('hl-goal-chips').children[0].click();
    expect(h.get('hl-goal-summary').textContent).toBe('Let Hook Lab infer');
  });

  it('requires evidence and explained editorial checks, never unsupported outcome instructions', () => {
    const prompt = harness().run("_hlBuildKickoffPrompt('idea')");
    for (const text of ['Never fabricate testimonials', 'unsupported promises', 'spoken-time', 'repetition', 'brand-evidence', 'No predicted virality', 'Do not fetch links', 'externally approved']) expect(prompt).toContain(text);
    expect(prompt).not.toContain('Aim 20+'); expect(prompt).not.toContain('Problem+Promise');
  });
  it('bounds context, prototypes, brand and enum input', () => {
    const h = harness(); h.get('hl-evidence').value = 'a'.repeat(4001);
    expect(() => h.run("_hlBuildKickoffPrompt('idea')")).toThrow(); h.get('hl-evidence').value = '';
    h.get('hl-duration').value = '181'; expect(() => h.run('_hlCurrent()')).toThrow(); h.get('hl-duration').value = '30';
    h.get('hl-mode').value = '__proto__'; expect(() => h.run("_hlBuildKickoffPrompt('idea')")).toThrow();
    expect(() => h.run('_hlValidate(Object.create({}))')).toThrow();
    h.run("_hlPickedBrandId='rejected'"); expect(() => h.run('_hlCurrent()')).toThrow();
  });
  it('same names get unique IDs, isolate brands and reload exactly', () => {
    const h = harness(); h.run('_hlSaveCurrent(); _hlSaveCurrent()');
    const saved = h.run('_hlReadSaved()'); expect(saved).toHaveLength(2); expect(saved[0].id).not.toBe(saved[1].id);
    const reload = harness(h.store); expect(reload.run('_hlReadSaved()[0].elements.verbal')).toBe(h.get('hl-selected-verbal').value);
    reload.run("_hlPickedBrandId='brand-b'; _hlRenderSaved()"); expect(reload.get('hl-saved').children).toHaveLength(0);
    reload.run("_hlPickedBrandId='brand-a'; _hlRenderSaved()"); expect(reload.get('hl-saved').children).toHaveLength(2);
  });
  it('storage failures, invalid records and full capacity preserve saved data', () => {
    const h = harness(); h.run('_hlSaveCurrent()'); const before = h.store.get('hl-combinations-v1');
    h.run("localStorage.setItem = () => { throw Error('quota'); }; _hlSaveCurrent()");
    expect(h.get('hl-selection-status').textContent).toContain('Save failed'); expect(h.store.get('hl-combinations-v1')).toBe(before);
    const full = harness(); full.run('for(let i=0;i<100;i++) _hlSave(_hlCurrent())');
    expect(() => full.run('_hlSave(_hlCurrent())')).toThrow(/full/); expect(full.run('_hlReadSaved().length')).toBe(100);
    full.store.set('hl-combinations-v1', '{"version":99,"items":[]}'); full.run('_hlSaveCurrent()'); expect(full.store.get('hl-combinations-v1')).toContain('99');
  });
  it('preserves orphan records while current-brand records remain usable; unknown input still fails closed', () => {
    const h = harness(); h.run('_hlSaveCurrent()');
    h.run("_hlPickedBrandId='brand-b'; _hlSaveCurrent(); _hlBrands=[{id:'brand-b',name:'B'}]");
    const before = h.store.get('hl-combinations-v1');
    h.run('_hlRenderSaved()'); expect(h.run('_hlReadSaved().length')).toBe(2);
    expect(h.get('hl-saved').children[0].children[0].disabled).toBe(true);
    h.get('hl-selected-verbal').value = 'changed'; h.get('hl-saved').children[1].children[0].click();
    expect(h.get('hl-selected-verbal').value).toContain('verbal:');
    expect(() => h.run('_hlValidate(_hlReadSaved()[0])')).toThrow(/Unknown/);
    h.run("_hlPickedBrandId='brand-a'; _hlHandoff()"); expect(h.store.has('hl-video-draft-v1')).toBe(false);
    expect(() => h.run("_hlBuildKickoffPrompt('idea')")).toThrow(/Unknown/);
    expect(h.store.get('hl-combinations-v1')).toBe(before);
    h.run("_hlPickedBrandId='brand-b'; _hlSaveCurrent()"); expect(h.run('_hlReadSaved().length')).toBe(3);
    expect(h.run('JSON.stringify(_hlReadSaved()[0])')).toBe(JSON.stringify(JSON.parse(before!).items[0]));
  });
  it('capacity recovery is reachable through named remove, cancellation, undo and explicit discard', () => {
    const h = harness(); h.run('for(let i=0;i<100;i++) _hlSave(_hlCurrent()); _hlRenderSaved()');
    const before = JSON.parse(h.store.get('hl-combinations-v1')!);
    h.run("window.confirm = message => { globalThis.confirmation = message; return false; }");
    h.get('hl-saved').children[0].children[1].click(); expect(h.run('_hlReadSaved().length')).toBe(100);
    expect(h.run('confirmation')).toContain('Same'); expect(h.run('confirmation')).toContain(before.items[0].id);
    h.run('window.confirm = () => true'); h.get('hl-saved').children[0].children[1].click();
    expect(h.run('_hlReadSaved().length')).toBe(99); expect(h.get('hl-undo-removal').disabled).toBe(false);
    expect(() => h.run('_hlSave(_hlCurrent())')).toThrow(/recovery slot/);
    h.run('_hlUndoRemoval()'); expect(h.run('_hlReadSaved().length')).toBe(100);
    expect(h.run('JSON.stringify(_hlReadSaved().at(-1))')).toBe(JSON.stringify(before.items[0]));
    h.get('hl-saved').children[0].children[1].click(); h.run('_hlDiscardUndo(); _hlSaveCurrent()');
    expect(h.run('_hlReadSaved().length')).toBe(100); expect(h.run('_hlUndo')).toBe(null);
  });
  it('removal rejects concurrent confirmation changes and quota failure; undo preserves later records', () => {
    const h = harness(); h.run('_hlSaveCurrent(); _hlRenderSaved()');
    h.run('window.confirm = () => { _hlSave(_hlCurrent()); return true; }');
    h.get('hl-saved').children[0].children[1].click(); expect(h.run('_hlReadSaved().length')).toBe(2);
    expect(h.get('hl-selection-status').textContent).toContain('changed during confirmation');
    const before = h.store.get('hl-combinations-v1');
    h.run("window.confirm = () => true; globalThis.originalSet = localStorage.setItem; localStorage.setItem = () => { throw Error('quota'); }");
    h.get('hl-saved').children[0].children[1].click(); expect(h.store.get('hl-combinations-v1')).toBe(before); expect(h.run('_hlUndo')).toBe(null);
    h.run('localStorage.setItem = originalSet'); h.get('hl-saved').children[0].children[1].click();
    h.run('_hlSaveCurrent(); localStorage.setItem = () => { throw Error("quota"); }; _hlUndoRemoval()');
    expect(h.run('_hlUndo')).not.toBe(null); expect(h.run('_hlReadSaved().length')).toBe(2);
    h.run('localStorage.setItem = originalSet; _hlUndoRemoval()'); expect(h.run('_hlReadSaved().length')).toBe(3);
  });
  it('deterministic advisory counts only spoken words, flags exact repetition/missing evidence without mutation', () => {
    const h = harness(); h.get('hl-selected-verbal').value = 'one two three four five';
    h.get('hl-selected-text').value = ' ONE  TWO three four five '; h.get('hl-duration').value = '1';
    const before = h.run('JSON.stringify(_hlCurrent())'); h.run('_hlCheckSelection()');
    const message = h.get('hl-selection-advisory').textContent;
    for (const text of ['5 whitespace-separated verbal words', '150 words/minute = 2.0 seconds', 'exceeds', 'Repeated full element text', 'No evidence supplied', 'do not detect truth']) expect(message).toContain(text);
    expect(h.run('JSON.stringify(_hlCurrent().elements)')).toBe(JSON.stringify(JSON.parse(before).elements));
    h.get('hl-evidence').value = '<img> claim supplied'; h.run('_hlCheckSelection()');
    expect(h.get('hl-selection-advisory').textContent).toContain('not verified or matched');
    h.run('window.confirm = () => false; _hlHandoff()'); expect(h.store.has('hl-video-draft-v1')).toBe(false);
    h.run('_hlSaveCurrent()'); h.get('hl-selected-verbal').value = 'new';
    expect(h.run("_hlBuildKickoffPrompt('idea')")).not.toContain('one two three four five');
  });
  it('brand-load failure preserves selection and rejects generation/handoff rather than falling back', async () => {
    const h = harness(); h.run("window.pocketAgent = { brands: { list: async () => { throw Error('offline'); } } }");
    await h.run('_hlLoadState()'); expect(h.run('_hlPickedBrandId')).toBe('brand-a');
    expect(() => h.run("_hlBuildKickoffPrompt('idea')")).toThrow(/Unknown/);
    h.run('_hlHandoff()'); expect(h.store.has('hl-video-draft-v1')).toBe(false);
  });
  it('escaped JSON draft fits review bound and review card expands without HTML', () => {
    const h = harness(); for (const k of ['verbal', 'text', 'visual', 'audio', 'caption']) h.get('hl-selected-' + k).value = '\u0001'.repeat(2000);
    h.get('hl-evidence').value = '\u0001'.repeat(4000);
    h.run("document.getElementById('vs-hook-review').closest = () => ({classList: {add: value => {globalThis.expanded = value;}}})");
    h.run('_hlHandoff()'); expect(h.store.get('hl-video-draft-v1')!.length).toBeGreaterThan(30000);
    expect(h.run('_vsReviewHookDraft().elements.verbal')).toBe(h.get('hl-selected-verbal').value);
    expect(h.run('expanded')).toBe('expanded');
  });
  it('exact five elements/context/brand survive handoff and new VM/session; malicious text is never HTML', () => {
    const h = harness(); const expected = h.run('JSON.stringify(_hlCurrent().elements)');
    h.run('_hlHandoff()'); expect(h.store.has('hl-combinations-v1')).toBe(false);
    const pending = h.store.get('hl-video-draft-v1'); h.run('_hlHandoff()'); expect(h.store.get('hl-video-draft-v1')).toBe(pending);
    const reload = harness(h.store);
    expect(reload.run('JSON.stringify(_vsReviewHookDraft().elements)')).toBe(expected);
    expect(reload.run('_vsReviewHookDraft().brandId')).toBe('brand-a'); expect(reload.run('_vsReviewHookDraft().context.duration')).toBe('30');
    expect(reload.get('vs-hook-review').textContent).toContain(h.get('hl-selected-verbal').value);
    h.get('hl-save-name').value = '<img onerror=evil()>'; h.run('_hlSaveCurrent()');
    expect(h.get('hl-saved').children[0].children[0].textContent).toContain('<img onerror=evil()>');
  });
});
