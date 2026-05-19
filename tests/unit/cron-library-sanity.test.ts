/**
 * Cron library sanity tests.
 *
 * History: in beta.9 we shipped on node-cron@4.2.1, which has a day-of-week
 * parsing bug — `0 6 * * 2` (Tue) computed its next-run as Jan 1, 2030, so the
 * weekly PMMA cron never fired for weeks. Brett caught it by noticing his
 * Tuesday 6 AM job didn't produce a packet. We swapped to croner in beta.10.
 *
 * This file is the regression dam. If someone "upgrades" the cron library
 * again and silently re-introduces a similar parsing bug, these tests fail.
 * They use the REAL library (no mocks) — that's the point.
 */
import { describe, it, expect } from 'vitest';
import { Cron } from 'croner';

describe('cron library — day-of-week parsing', () => {
  // Every day-of-week digit 0-6 should produce a next-run within the next 7
  // days. Anything beyond that means the parser is misinterpreting the field.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
    it(`computes next-run within 7 days for "0 6 * * ${dow}"`, () => {
      const c = new Cron(`0 6 * * ${dow}`, { paused: true }, () => {});
      const nextRun = c.nextRun();
      c.stop();

      expect(nextRun).not.toBeNull();
      const daysOut = (nextRun!.getTime() - Date.now()) / 86400000;
      expect(daysOut).toBeLessThan(8);
      expect(daysOut).toBeGreaterThanOrEqual(0);

      // The computed Date's getDay() must equal the requested DOW. This is
      // the specific bug node-cron@4 had — it produced a date whose getDay()
      // matched the input, but on the wrong year, several years out.
      expect(nextRun!.getDay()).toBe(dow);
    });
  }

  it('next-run for "* * * * *" is within the next 2 minutes', () => {
    const c = new Cron('* * * * *', { paused: true }, () => {});
    const nextRun = c.nextRun();
    c.stop();
    expect(nextRun).not.toBeNull();
    const msOut = nextRun!.getTime() - Date.now();
    expect(msOut).toBeLessThan(2 * 60 * 1000);
    expect(msOut).toBeGreaterThan(0);
  });

  it('throws on an obviously invalid expression', () => {
    expect(() => new Cron('not a cron', { paused: true }, () => {})).toThrow();
  });
});
