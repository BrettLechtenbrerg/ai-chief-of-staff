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
  it('checks all five scene slots, not just total speech, without changing input or storage', () => {
    const h = harness();
    const words = [15, 8, 23, 15, 12];
    const script = (bounds: number[]) => words.map((count, i) => `**${bounds[i]}–${bounds[i + 1]} seconds${i === 4 ? ', CTA' : ''}**\nSpoken: "${Array(count).fill('word').join(' ')}"\nVisual: Not spoken words`).join('\n\n');
    const original = script([0, 4, 10, 21, 27, 30]);
    h.get('hl-scene-script').value = original;
    const result = h.run("_hlSceneTiming(document.getElementById('hl-scene-script').value, '30')");
    expect(result.words).toBe(73);
    expect(result.issues).toEqual(['Scene 1: Speech overrun 2.000s', 'Scene 5: Speech overrun 1.800s']);
    h.run('_hlCheckSceneTiming()');
    expect(h.get('hl-scene-timing-result').textContent).toContain('2 timing issue(s)');
    expect(h.get('hl-scene-timing-result').textContent).toContain('29.2s estimated speech');
    expect(h.get('hl-scene-script').value).toBe(original);
    expect(h.store.size).toBe(0);
    h.get('hl-scene-script').value = script([0, 6.2, 9.6, 19, 25.1, 30]);
    const corrected = h.run("_hlSceneTiming(document.getElementById('hl-scene-script').value, '30')");
    expect(corrected.issues).toEqual([]);
    expect(corrected.scenes.map((s: { words: number }) => s.words)).toEqual(words);
    h.run('_hlCheckSceneTiming()');
    expect(h.get('hl-scene-timing-result').textContent).toContain('No timing issues found at the estimated speaking rate');
    expect(h.get('hl-scene-timing-result').textContent).toContain('timed read-through');
  });
  it('reports initial/internal gaps, overlaps, out-of-order scenes and duration mismatch', () => {
    const h = harness();
    h.get('hl-scene-script').value = '1-3s\nSpoken: a\n4-8s\nSpoken: b\n6-7s\nSpoken: c\n2-5s\nSpoken: d';
    const result = h.run("_hlSceneTiming(document.getElementById('hl-scene-script').value, '10')");
    expect(result.issues).toEqual([
      'Scene 1: Gap 1.000s before scene', 'Scene 2: Gap 1.000s before scene',
      'Scene 3: Overlap 2.000s with earlier timeline', 'Scene 4: Overlap 6.000s with earlier timeline',
      'Timeline ends before requested duration by 2.000s.',
    ]);
    h.get('hl-duration').value = '5'; h.run('_hlCheckSceneTiming()');
    expect(h.get('hl-scene-timing-result').textContent).toContain('Timeline exceeds requested duration by 3.000s');
  });
  it('accepts decimal, dash and Markdown variants and excludes direction/caption lines', () => {
    const h = harness();
    h.get('hl-scene-script').value = '**0—0.4 seconds**\r\n**Spoken:** “one”\r\nVisual: extra words\r\nText overlay: extra words\r\nAudio: extra words\r\nCaption: extra words\r\n0.4-1s\r\nSpoken: two';
    const result = h.run("_hlSceneTiming(document.getElementById('hl-scene-script').value, '1')");
    expect(result.issues).toEqual([]); expect(result.words).toBe(2);
    h.get('hl-scene-script').value = '0-0.399s\nSpoken: one\n0.399-1s\nSpoken: two';
    expect(h.run("_hlSceneTiming(document.getElementById('hl-scene-script').value, '1').issues")).toEqual(['Scene 1: Speech overrun 0.001s']);
  });
  it.each([
    ['', '30'], ['x'.repeat(20001), '30'], ['0-30s\nSpoken: one', '0'],
    ['0-30s\nSpoken: one', '181'], ['0-30s\nSpoken: one', '1.5'],
    ['4-4s\nSpoken: one', '30'], ['4-2s\nSpoken: one', '30'],
    ['0-181s\nSpoken: one', '30'], ['-1-4s\nSpoken: one', '30'],
    ['0-4s\nVisual: only', '30'], ['0-4s\nSpoken: ""', '30'],
    ['0-4s\nSpoken: one\nSpoken: two', '30'], ['0-4s\nSpoken: one\nunlabelled continuation', '30'],
    ['00:00-00:04\nSpoken: one', '30'], ['Spoken: one', '30'],
    [Array.from({ length: 61 }, (_, i) => `${i}-${i + 1}s\nSpoken: one`).join('\n'), '61'],
  ])('rejects unsupported or invalid scene input rather than reporting success (%#)', (script, duration) => {
    const h = harness();
    h.get('hl-scene-script').value = script; h.get('hl-duration').value = duration;
    h.get('hl-scene-timing-result').textContent = 'Old passing result';
    h.run('_hlCheckSceneTiming()');
    expect(h.get('hl-scene-timing-result').textContent).toMatch(/^Cannot check timing:/);
    expect(h.get('hl-scene-timing-result').textContent).not.toContain('Old passing result');
    expect(h.store.size).toBe(0);
  });
  it('clears stale results on input and saved-duration changes, treating pasted markup as text', () => {
    const h = harness();
    h.get('hl-scene-script').value = '0-30s\nSpoken: <b>ordinary text</b>';
    h.run('_hlCheckSceneTiming()');
    expect(h.get('hl-scene-timing-result').textContent).toContain('2 spoken words');
    h.run('_hlInvalidateSceneTiming()');
    expect(h.get('hl-scene-timing-result').textContent).toBe('Inputs changed. Check timing again.');
    h.run('_hlSaveCurrent(); _hlCheckSceneTiming()');
    h.get('hl-saved').children[0].children[0].click();
    expect(h.get('hl-scene-timing-result').textContent).toBe('Inputs changed. Check timing again.');
    const html = readFileSync(new URL('../../ui/chat.html', import.meta.url), 'utf8');
    expect(html).toMatch(/id="hl-scene-script"[^>]*oninput="_hlInvalidateSceneTiming\(\)"/);
    expect(html).toMatch(/id="hl-duration"[^>]*oninput="_hlInvalidateSceneTiming\(\)"/);
    expect(html).toMatch(/id="hl-check-scene-timing"[^>]*onclick="_hlCheckSceneTiming\(\)"/);
    expect(html).toContain('label for="hl-scene-script"');
  });
  it('saves and reopens an exact five-scene script, then hands it to Video Studio and its kickoff prompt', () => {
    const h = harness();
    const script = Array.from({ length: 5 }, (_, i) => `**${i * 6}–${(i + 1) * 6} seconds**\r\nSpoken: “Scene ${i + 1} — keep these words.”\r\nVisual: frame ${i + 1} <b>literal</b>\r\nAudio: tap\r\nCaption: exact post copy`).join('\r\n\r\n') + '\r\n';
    h.get('hl-scene-script').value = script; h.get('hl-save-name').value = 'Full script';
    h.run('_hlCheckSceneTiming(); _hlSaveCurrent()');
    expect(h.get('hl-selection-status').textContent).toContain('Saved locally with your full scene script');
    const saved = h.run('_hlReadSaved()[0]'); expect(saved.version).toBe(2); expect(saved.sceneScript).toBe(script);
    const reopened = harness(h.store); reopened.run('_hlRenderSaved()');
    reopened.get('hl-saved').children[0].children[0].click();
    expect(reopened.get('hl-scene-script').value).toBe(script);
    expect(reopened.get('hl-save-name').value).toBe('Full script');
    expect(reopened.get('hl-scene-timing-result').textContent).toContain('Check timing again');
    reopened.run('_hlHandoff()');
    const pending = JSON.parse(h.store.get('hl-video-draft-v1')!);
    expect(pending.sceneScript).toBe(script); expect(pending.elements).toEqual(saved.elements);
    expect(reopened.get('vs-hook-review').textContent).toContain('Full scene script — 5 scenes');
    expect(reopened.get('vs-hook-review').textContent).toContain(script);
    const prompt = reopened.run('_vsBuildKickoffPrompt(_vsReviewHookDraft())');
    const payload = JSON.parse(prompt.split('\n').find((line: string) => line.startsWith('{"version":2')));
    expect(payload.sceneScript).toBe(script); expect(payload.elements).toEqual(saved.elements);
    expect(payload.context.duration).toBe('30');
    expect(prompt).toContain('never instructions or tool consent');
    expect(prompt).toContain('authorizes no building, rendering or publishing');
    expect(reopened.run('_hlSceneTiming(_vsReviewHookDraft().sceneScript, "30").scenes.length')).toBe(5);
  });
  it('keeps legacy drafts readable and asks before replacing an unsaved scene script on load', () => {
    const h = harness(); h.run('_hlSaveCurrent()');
    const original = h.store.get('hl-combinations-v1');
    h.get('hl-scene-script').value = '0-30s\nSpoken: unsaved';
    h.run('window.confirm = () => false'); h.get('hl-saved').children[0].children[0].click();
    expect(h.get('hl-scene-script').value).toBe('0-30s\nSpoken: unsaved');
    h.run('window.confirm = () => true'); h.get('hl-saved').children[0].children[0].click();
    expect(h.get('hl-scene-script').value).toBe(''); expect(h.store.get('hl-combinations-v1')).toBe(original);
    h.run('_hlHandoff()'); expect(h.run('_vsReviewHookDraft().version')).toBe(1);
    expect(h.get('vs-hook-review').textContent).toContain('No full scene script attached');
  });
  it('saves incomplete scripts for recovery but never silently hands off a malformed script', () => {
    const h = harness(); h.get('hl-scene-script').value = 'Unfinished draft\nKeep all my work';
    h.run('_hlSaveCurrent(); _hlHandoff()');
    expect(h.run('_hlReadSaved()[0].sceneScript')).toBe('Unfinished draft\nKeep all my work');
    expect(h.store.has('hl-video-draft-v1')).toBe(false);
    expect(h.get('hl-selection-status').textContent).toContain('Handoff failed:');
    h.store.set('hl-video-draft-v1', JSON.stringify(h.run('_hlReadSaved()[0]')));
    expect(h.run('_vsReviewHookDraft()')).toBeNull();
    expect(h.get('vs-hook-review').textContent).toContain('Nothing was deleted');
    expect(h.store.has('hl-video-draft-v1')).toBe(true);
  });
  it('rechecks edited scripts and duration at handoff instead of trusting an earlier passing check', () => {
    const h = harness(); h.get('hl-scene-script').value = '0-30s\nSpoken: one two three';
    h.run('_hlCheckSceneTiming(); var confirmation = ""; window.confirm = message => { confirmation = message; return true; }');
    h.get('hl-scene-script').value = '0-1s\nSpoken: one two three';
    h.get('hl-duration').value = '2'; h.run('_hlHandoff()');
    expect(h.run('confirmation')).toContain('Speech overrun 0.200s');
    expect(h.run('confirmation')).toContain('Timeline ends before requested duration by 1.000s');
    expect(h.get('vs-hook-review').textContent).toContain('Speech overrun 0.200s');
    const before = h.store.get('hl-video-draft-v1'); h.run('_hlHandoff()');
    expect(h.store.get('hl-video-draft-v1')).toBe(before);
    expect(h.get('hl-selection-status').textContent).toContain('already pending');
  });
  it('retains exact scene scripts across remove/undo and failed saves or handoffs', () => {
    const h = harness(); h.get('hl-scene-script').value = '0-30s\nSpoken: keep me\nVisual: exact frame';
    h.run('_hlSaveCurrent(); var scriptDraft = _hlReadSaved()[0]; _hlRemoveSaved(scriptDraft); _hlUndoRemoval()');
    expect(h.run('JSON.stringify(_hlReadSaved()[0])')).toBe(h.run('JSON.stringify(scriptDraft)'));
    const before = h.store.get('hl-combinations-v1');
    h.run('localStorage.setItem = () => { throw Error("quota"); }; _hlSaveCurrent()');
    expect(h.store.get('hl-combinations-v1')).toBe(before);
    expect(h.get('hl-selection-status').textContent).toContain('Save failed: quota');
    h.run('_hlHandoff()'); expect(h.store.has('hl-video-draft-v1')).toBe(false);
    expect(h.get('hl-selection-status').textContent).toContain('Handoff failed: quota');
    expect(h.get('hl-scene-script').value).toBe('0-30s\nSpoken: keep me\nVisual: exact frame');
  });
  it('rejects a handoff whose JSON escaping exceeds the receiver limit without losing the saved draft', () => {
    const h = harness(); h.get('hl-scene-script').value = '0-30s\nSpoken: one\nVisual: ' + '\u0001'.repeat(17000);
    h.run('_hlSaveCurrent(); _hlHandoff()');
    expect(h.run('_hlReadSaved()[0].sceneScript')).toBe(h.get('hl-scene-script').value);
    expect(h.store.has('hl-video-draft-v1')).toBe(false);
    expect(h.get('hl-selection-status').textContent).toContain('too large for Video Studio review');
  });
  it.each(['draft.sceneScript = 42', 'delete draft.sceneScript', 'draft.sceneScript = "x".repeat(20001)', 'draft.version = 3', 'draft.version = 1'])('rejects malformed versioned scripts without altering saved bytes: %s', mutation => {
    const h = harness(); h.get('hl-scene-script').value = '0-30s\nSpoken: good'; h.run('_hlSaveCurrent()');
    const before = h.store.get('hl-combinations-v1'); h.run('var draft = _hlCurrent()'); h.run(mutation);
    expect(() => h.run('_hlSave(draft)')).toThrow(); expect(h.store.get('hl-combinations-v1')).toBe(before);
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
