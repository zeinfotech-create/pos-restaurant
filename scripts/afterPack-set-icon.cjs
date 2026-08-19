// ============================================================
// afterPack hook — stamps the app's own icon onto the packaged .exe's PE
// resources (what Windows actually reads for the Start Menu tile, taskbar
// pinned icon, and search results — separate from the in-window/tray icon
// electron/main.cjs sets at runtime via getIconPath()).
//
// electron-builder's own built-in "signAndEditExecutable" option normally
// does this via rcedit too, but it's disabled here (see electron-builder.json)
// because turning it on makes electron-builder also try to download
// winCodeSign (a bundled macOS+Windows signing/rcedit toolkit) — and that
// download's macOS .dylib symlinks fail to extract on this machine without
// Developer Mode / admin privileges (see the comment on signAndEditExecutable
// in electron-builder.json). rcedit itself doesn't need any of that: the
// `rcedit` npm package (already a transitive devDependency here) ships its
// own small rcedit-x64.exe with no extra download, so calling it directly
// sidesteps the whole broken path while still getting the icon stamped.
// ============================================================
const path = require('path');
const fs = require('fs');
const rcedit = require('rcedit');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(context.outDir, '.icon-ico', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack-set-icon] exe not found at ${exePath}, skipping icon stamp`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack-set-icon] icon.ico not found at ${iconPath}, skipping icon stamp`);
    return;
  }

  console.log(`[afterPack-set-icon] Stamping icon onto ${exePath}`);
  await rcedit(exePath, { icon: iconPath });
  console.log('[afterPack-set-icon] Done.');
};
