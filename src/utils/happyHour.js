// Shared, dependency-free Happy Hour rule matching — used by BOTH
// RestaurantPOS.js (to apply a discount the moment an item's added to cart,
// and to badge the menu grid while a deal is live) and, if this shop ever
// wants it, any other checkout surface — the "is this rule active right
// now, for this product" question has exactly one answer regardless of
// where it's asked from.
//
// A rule (Settings > KOT > Happy Hour Deals):
//   { id, name, startTime: 'HH:MM', endTime: 'HH:MM', daysOfWeek: [0-6],
//     discountPercent, scope: 'all' | <category name>, enabled }
// daysOfWeek uses JS's own Date.getDay() numbering (0 = Sunday).

// A window like "22:00"–"02:00" wraps past midnight — active whenever the
// current time is AFTER start OR BEFORE end, not a plain between-check
// (which would never be true for a window that crosses the day boundary).
function isWithinTimeWindow(startTime, endTime, nowMinutes) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  if (startMinutes <= endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// Every rule (enabled, right now, in scope for this product), not just the
// first match — a caller picking "the best one" needs to see all of them,
// not have this function silently decide for it.
export function getActiveHappyHourRules(rules, product, now = new Date()) {
  if (!rules?.length) return [];
  const day = now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return rules.filter(r => {
    if (r.enabled === false) return false;
    if (!r.startTime || !r.endTime || !r.discountPercent) return false;
    if (r.daysOfWeek?.length && !r.daysOfWeek.includes(day)) return false;
    if (r.scope && r.scope !== 'all' && r.scope !== product?.category) return false;
    return isWithinTimeWindow(r.startTime, r.endTime, nowMinutes);
  });
}

// The single number a caller actually wants: the BEST (highest) discount
// currently available for this product, or 0 if nothing applies — never
// stacks multiple matching rules, a customer gets whichever deal is most
// generous, not the sum of all of them.
export function getActiveHappyHourDiscountPercent(rules, product, now = new Date()) {
  const active = getActiveHappyHourRules(rules, product, now);
  if (!active.length) return 0;
  return Math.max(...active.map(r => r.discountPercent));
}
