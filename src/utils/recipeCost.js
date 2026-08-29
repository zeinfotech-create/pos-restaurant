// Shared, dependency-free recipe/BOM (Bill of Materials) cost math — used by
// BOTH Products.js (the live "estimated cost" readout while editing a
// recipe) and db.js's saveOrder() (the real cost snapshotted onto an order
// line the moment a recipe product actually sells). Keeping this in one
// place means the number a shop owner sees while building a recipe can
// never drift from the number that actually lands in their profit reports —
// two independent copies of this formula would be exactly the kind of bug
// that quietly overstates or understates margin for months before anyone
// notices the two disagree.
//
// A recipe ingredient's `qty` is ALWAYS in that ingredient PRODUCT's own
// configured `unit` (kg/g/ltr/pcs/...) — not a per-row unit choice. Rice
// costed at ₹80/kg with a recipe qty of 0.2 means 200g; entering "200" by
// mistake (thinking grams) would 1000x the real cost. Products.js's recipe
// editor shows the ingredient's own unit next to the qty input specifically
// to keep this from being a silent trap.

// A product is "recipe-based" the moment it has at least one ingredient row
// — no separate on/off flag needed, the array itself is the source of truth
// (mirrors how `variants.length > 0` already decides hasVariants elsewhere
// in this codebase, rather than a redundant boolean that could drift from
// the array it's describing).
export function hasRecipe(product) {
  return !!(product?.recipe?.ingredients && product.recipe.ingredients.length > 0);
}

// Sum of (ingredient unit cost × recipe qty) across every ingredient row.
// `allProducts` is the full product list (same shape getProducts() / the
// products array already threaded through saveOrder()'s stock loop returns)
// — passed in rather than fetched here so a caller already holding a fresh
// copy (or, in Products.js's live preview, one that includes THIS product's
// own in-progress edits) never pays for or risks a second, possibly-stale
// fetch.
export function computeRecipeCost(recipe, allProducts) {
  if (!recipe?.ingredients?.length) return 0;
  return recipe.ingredients.reduce((total, ing) => {
    const ingredientProduct = allProducts.find(p => p.id === ing.productId);
    const unitCost = ingredientProduct?.costPrice || 0;
    return total + (unitCost * (Number(ing.qty) || 0));
  }, 0);
}
