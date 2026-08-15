// Pure parsing logic for weight-scale serial output — deliberately kept
// free of any Electron/serialport imports so it can be unit-tested
// (via Vitest) without spinning up Electron or needing real hardware
// attached to a COM port.
//
// Covers the de-facto "Toledo/CAS continuous output" framing used by most
// Indian retail scale indicators — e.g. "ST,GS,+  12.340kg" (Stable/
// Unstable flag, Gross/Net flag, signed weight, unit) — as well as plain
// generic numeric lines ("12.340 kg", "12.340", "WT:12.340KG"). Rather
// than three separate vendor-specific state machines, one tolerant regex
// pulls the first signed decimal number (with an optional adjacent unit)
// out of whatever the scale sent, which is what actually differs between
// those formats in practice: framing text around the number, not the
// number itself.
function parseScaleLine(line) {
  if (!line) return null;
  const cleaned = String(line).trim();
  if (!cleaned) return null;

  const match = cleaned.match(/([+-]?\d+\.?\d*)\s*(kg|g|lb)?/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return null;

  const unit = (match[2] || 'kg').toLowerCase();
  let kg = value;
  if (unit === 'g') kg = value / 1000;
  else if (unit === 'lb') kg = value * 0.453592;

  // Scales sometimes send a small negative reading as tare/zero-drift
  // noise — the physical weight itself is never negative for our purposes.
  return Math.abs(kg);
}

module.exports = { parseScaleLine };
