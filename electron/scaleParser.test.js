import { describe, it, expect } from 'vitest';
import { parseScaleLine } from './scaleParser.cjs';

describe('parseScaleLine', () => {
  it('parses Toledo/CAS-style continuous output framing', () => {
    expect(parseScaleLine('ST,GS,+  12.340kg\r\n')).toBeCloseTo(12.34, 3);
    expect(parseScaleLine('US,GS,+00000.05kg')).toBeCloseTo(0.05, 3);
  });

  it('parses plain generic numeric lines', () => {
    expect(parseScaleLine('12.340 kg')).toBeCloseTo(12.34, 3);
    expect(parseScaleLine('12.340')).toBeCloseTo(12.34, 3);
    expect(parseScaleLine('WT:12.340KG')).toBeCloseTo(12.34, 3);
  });

  it('converts grams and pounds to kg', () => {
    expect(parseScaleLine('500 g')).toBeCloseTo(0.5, 3);
    expect(parseScaleLine('2.2lb')).toBeCloseTo(2.2 * 0.453592, 3);
  });

  it('treats a negative (tare/zero-drift) reading as its absolute weight', () => {
    expect(parseScaleLine('-0.050kg')).toBeCloseTo(0.05, 3);
  });

  it('returns null for empty, whitespace-only, or numberless input', () => {
    expect(parseScaleLine('')).toBeNull();
    expect(parseScaleLine('   ')).toBeNull();
    expect(parseScaleLine(null)).toBeNull();
    expect(parseScaleLine(undefined)).toBeNull();
    expect(parseScaleLine('ERR,NO_MOTION')).toBeNull();
  });

  it('returns 0 for a genuine zero reading (empty scale pan)', () => {
    expect(parseScaleLine('0.000 kg')).toBe(0);
  });
});
