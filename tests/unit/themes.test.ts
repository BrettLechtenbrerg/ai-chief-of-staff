import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { THEMES } from '../../src/settings/themes';

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('Orbital Command', () => {
  it('keeps text, semantic labels and controls legible across its surfaces', () => {
    const p = THEMES['orbital-command'].palette!;
    for (const bg of [p['bg-primary'], p['bg-secondary'], p['bg-tertiary'], p['user-bubble-solid']]) {
      for (const fg of [p['text-primary'], p['text-secondary'], p['text-muted'], p.accent, p['accent-secondary'], p.warning, p.error, p.success]) {
        expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(p.border, bg), `control border on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    for (const fill of [p.accent, p['accent-hover'], p.warning, p.error]) {
      expect(contrast(p['bg-primary'], fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the existing loader and completely clears its colors when switching themes', async () => {
    const properties = new Map<string, string>();
    const dataset: Record<string, string> = {};
    let ready = () => {};
    let changed = (_id: string) => {};
    const context = vm.createContext({
      document: { documentElement: { dataset, style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        removeProperty: (key: string) => properties.delete(key),
      } } },
      window: {
        addEventListener: (_event: string, fn: () => void) => { ready = fn; },
        pocketAgent: { themes: {
          list: async () => THEMES, getSkin: async () => 'orbital-command',
          onSkinChanged: (fn: (id: string) => void) => { changed = fn; },
        } },
      },
    });
    vm.runInContext(fs.readFileSync(path.resolve('ui/shared/theme-loader.js'), 'utf8'), context);
    ready();
    await new Promise(resolve => setImmediate(resolve));
    expect(dataset.skin).toBe('orbital-command');
    expect(properties.get('--accent')).toBe('#5cdeff');
    changed('tsai');
    expect(dataset.skin).toBe('tsai');
    expect(properties.get('--accent')).toBe(THEMES.tsai.palette!.accent);
    changed('dracula');
    expect(properties.size).toBe(0);
    expect(dataset.skin).toBe('dracula');
  });
});
