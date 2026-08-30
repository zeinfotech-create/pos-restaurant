// Shared, dependency-free FSSAI-style veg/non-veg/egg mark — a small square
// outline with a colored dot inside (green square+dot = veg, brown/maroon
// square+dot = non-veg, egg gets its own amber mark since it's neither in
// common Indian restaurant convention). Used anywhere a product/cart/order
// item's name is shown to staff or a customer (menu grid, cart, receipt) so
// the mark can't drift between screens — one function decides how it looks.
//
// product.foodType (or item.foodType, once it's carried through) is one of
// '' (not a food item — no mark), 'veg', 'non-veg', 'egg'.

const FOOD_TYPE_META = {
  veg: { color: '#1a7d1a', title: 'Veg' },
  'non-veg': { color: '#8b2c1a', title: 'Non-Veg' },
  egg: { color: '#b8860b', title: 'Contains Egg' }
};

// size in px (the square's side length); returns '' for no/unknown type so
// callers can just drop this inline with zero extra conditionals.
export function foodTypeIconHtml(foodType, size = 10) {
  const meta = FOOD_TYPE_META[foodType];
  if (!meta) return '';
  const dot = Math.round(size * 0.45);
  return `<span title="${meta.title}" style="display:inline-block; width:${size}px; height:${size}px; border:1.5px solid ${meta.color}; border-radius:2px; vertical-align:middle; position:relative; margin-right:4px;"><span style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:${dot}px; height:${dot}px; border-radius:50%; background:${meta.color};"></span></span>`;
}
