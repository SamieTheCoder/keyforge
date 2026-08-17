import { describe, expect, test } from 'vitest';
import { applyLedOrder, LED_PALETTES, LED_STATES, ledColour, orderFor, primariesOf } from './protocol';

const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const YELLOW = [255, 255, 0] as const;

describe('LED palettes', () => {
  test('match firmware neopixel_rgb_ordered()', () => {
    expect(applyLedOrder(0, RED)).toEqual([255, 0, 0]);
    expect(applyLedOrder(2, RED)).toEqual([0, 255, 0]); // GRB swaps red/green
    expect(applyLedOrder(2, GREEN)).toEqual([255, 0, 0]);
    expect(applyLedOrder(1, YELLOW)).toEqual([255, 0, 255]); // RBG: yellow -> magenta
    expect(applyLedOrder(4, YELLOW)).toEqual([0, 255, 255]); // BRG: yellow -> cyan
  });

  test('every palette gives each state a distinct colour', () => {
    for (const p of LED_PALETTES) {
      const colours = LED_STATES.map((s) => ledColour(p.order, s.rgb).toString());
      expect(new Set(colours).size).toBe(LED_STATES.length);
    }
  });

  test('brightness scales the preview but never to black', () => {
    expect(ledColour(0, RED, 15)).toBe('rgb(255 0 0)');
    expect(ledColour(0, RED, 0)).toBe('rgb(31 0 0)');
  });

  test('custom colours resolve to exactly one channel order and back', () => {
    expect(orderFor('green', 'red')).toBe(0);
    expect(orderFor('red', 'green')).toBe(2);
    expect(orderFor('blue', 'red')).not.toBeNull();
    expect(orderFor('red', 'red')).toBeNull();
    const seen = new Set<number>();
    for (const r of ['red', 'green', 'blue'] as const) {
      for (const n of ['red', 'green', 'blue'] as const) {
        if (r === n) continue;
        const o = orderFor(r, n)!;
        expect(primariesOf(o)).toEqual({ ready: r, noHost: n });
        seen.add(o);
      }
    }
    expect(seen.size).toBe(6);
  });
});
