// ============================================================
// build-customer-release.cjs
//
// Prepares a per-customer copy of the pos-lite source tree with a unique,
// hard-to-notice watermark embedded in a few different places. This does
// NOT prevent anyone from removing the watermark or bypassing license
// checks — nothing client-side can. Its only job is tracing: if a leaked/
// resold copy of the source ever turns up, the marker tells you which
// customer's copy it came from, which is what makes the license
// agreement's penalty/termination clauses actually enforceable against a
// specific party instead of "someone, somewhere".
//
// Usage:
//   node scripts/build-customer-release.cjs --customer "ABC Traders"
//   node scripts/build-customer-release.cjs --customer "ABC Traders" --out D:/releases
//
// Output: <out>/<customer-slug>-<marker>/  (a full source copy, watermarked)
// Registry: scripts/release-registry.json (customer <-> marker mapping —
//           keep this file yourself, never hand it to a customer)
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getArg(name, def) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : def;
}

const customerName = getArg('customer');
if (!customerName) {
  console.error('Usage: node scripts/build-customer-release.cjs --customer "Customer Name" [--out <dir>]');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
// Default output lives OUTSIDE the project tree — fs.cpSync refuses to copy
// a directory into its own subdirectory (Node throws ERR_FS_CP_EINVAL), and
// more importantly a customer release folder has no business living inside
// this dev repo where it could get swept into git or a future release copy.
const OUTPUT_BASE = path.resolve(getArg('out', path.join(ROOT, '..', 'pos-lite-releases')));
const REGISTRY_PATH = path.join(__dirname, 'release-registry.json');

// ── 1. Generate this release's unique marker ────────────────────────────
const timestamp = new Date().toISOString();
const randomPart = crypto.randomBytes(4).toString('hex');
const marker = crypto.createHash('sha256').update(customerName + timestamp + randomPart).digest('hex').slice(0, 12);

const slug = customerName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'customer';
const outputDir = path.join(OUTPUT_BASE, `${slug}-${marker}`);

if (fs.existsSync(outputDir)) {
  console.error(`[Release] Output directory already exists: ${outputDir}`);
  process.exit(1);
}

// ── 2. Copy the source tree, excluding build artifacts, VCS, secrets, and ──
// dev-only tooling. Anything not needed by a customer building/running the
// app themselves, or that must never leave this machine (`.env`, `.git`
// history, this vendor's own CI/session config).
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'releases', '.cache',
  'backups', '.vite', 'legal',
  '.claude', '.github',       // this vendor's own tooling/CI config
  'docs', 'tests', 'test-results', 'temp', // dev docs + test suite + scratch
  // 'scripts' holds release-registry.json — every OTHER customer's name +
  // marker. Without excluding the whole folder, EVERY customer release was
  // silently shipping the full customer list to every other customer.
  'scripts',
]);
const EXCLUDE_FILE_NAMES = new Set([
  '.env',
  // Root-level one-off dev/build scripts — confirmed (grep across
  // electron/*.cjs, server/*.js, package.json) that none of them are
  // `require()`'d or referenced by any npm script; a customer building/
  // running the app never touches these.
  'assemble.cjs', 'build.cjs', 'build-installer.js', 'installer.cjs',
  'updater.cjs', 'patch_phone.cjs', 'rewrite_css.cjs', 'rewrite_css.js',
  'simulate_kiosk_payment.ps1', 'test-launch.cjs', 'test-main.cjs',
  'test_kiosk_dashboard.html', 'test_webhook_connection.ps1',
  'playwright.config.js', 'vitest.config.js',
]);
const EXCLUDE_FILE_SUFFIXES = ['.log'];

console.log(`[Release] Copying source tree to ${outputDir} ...`);
fs.mkdirSync(outputDir, { recursive: true });
fs.cpSync(ROOT, outputDir, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    if (rel === '') return true; // root itself
    const base = path.basename(src);
    if (EXCLUDE_DIR_NAMES.has(base)) return false;
    if (EXCLUDE_FILE_NAMES.has(base)) return false;
    if (base.startsWith('.env.')) return false;
    if (EXCLUDE_FILE_SUFFIXES.some(suf => base.endsWith(suf))) return false;
    return true;
  },
});

// ── 3. Embed the marker in a few different, functionally-plausible spots ──
// Redundant on purpose: a customer who finds and strips ONE of these still
// leaves the others in place. Each one is disguised as an ordinary field a
// real build pipeline would plausibly have, not something obviously
// labeled "watermark".
const touchedFiles = [];

// 3a. package.json — a "buildId" field is completely unremarkable; every
// real release-tracking setup has something like this.
{
  const pkgPath = path.join(outputDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.buildId = marker;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  touchedFiles.push('package.json (buildId field)');
}

// 3b. src/db.js DEFAULT_SETTINGS — this value gets written into the app's
// OWN local settings record at first run, so it isn't just sitting in a
// source file: it propagates into the customer's actual database. Removing
// it from source alone doesn't erase it from data already created before
// they noticed.
{
  const dbPath = path.join(outputDir, 'src', 'db.js');
  let dbSrc = fs.readFileSync(dbPath, 'utf8');
  const marker3b = `\n  releaseTag: '${marker}',`;
  const before = dbSrc;
  dbSrc = dbSrc.replace(
    /(const DEFAULT_SETTINGS = \{)/,
    `$1${marker3b}`
  );
  if (dbSrc === before) {
    console.warn('[Release] WARNING: could not find DEFAULT_SETTINGS in src/db.js — marker 3b not embedded.');
  } else {
    fs.writeFileSync(dbPath, dbSrc);
    touchedFiles.push('src/db.js (DEFAULT_SETTINGS.releaseTag)');
  }
}

// 3c. electron/main.cjs — a build-info constant used in the startup log
// line every build already prints, so its presence doesn't look inserted.
{
  const mainPath = path.join(outputDir, 'electron', 'main.cjs');
  let mainSrc = fs.readFileSync(mainPath, 'utf8');
  const injected = `\nconst BUILD_ID = '${marker}'; // release build identifier — do not remove\nconsole.log('[App] Build:', BUILD_ID);\n`;
  mainSrc = injected + mainSrc;
  fs.writeFileSync(mainPath, mainSrc);
  touchedFiles.push('electron/main.cjs (BUILD_ID constant)');
}

// ── 4. Record this release in the local registry (kept OUTSIDE the copy) ──
let registry = [];
if (fs.existsSync(REGISTRY_PATH)) {
  try { registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch (e) { registry = []; }
}
registry.push({
  customer: customerName,
  marker,
  shippedAt: timestamp,
  outputDir,
});
fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');

// ── 5. Done ──────────────────────────────────────────────────────────────
console.log(`\n[Release] Done.`);
console.log(`  Customer:   ${customerName}`);
console.log(`  Marker:     ${marker}`);
console.log(`  Output:     ${outputDir}`);
console.log(`  Watermarked files:`);
touchedFiles.forEach(f => console.log(`    - ${f}`));
console.log(`\n  Registry updated: ${REGISTRY_PATH}`);
console.log(`  (Keep this file yourself — never hand it to a customer.)`);
