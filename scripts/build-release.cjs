const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const originalVersion = pkg.version;

// 1. Calculate new version (bump patch)
const parts = originalVersion.split('.').map(Number);
parts[2] += 1;
const nextVersion = parts.join('.');

console.log(`\x1b[34m[Release]\x1b[0m Preparing version \x1b[1m${nextVersion}\x1b[0m (Current: ${originalVersion})`);

try {
  // 2. Temporarily update package.json
  pkg.version = nextVersion;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

  // 3. Run the build
  console.log(`\x1b[34m[Release]\x1b[0m Building installer...`);
  // Using 'inherit' so you can see the progress in the terminal
  // We move the cache to D: because C: is out of space, and skip broken extraction
  const newEnv = {
    ...process.env,
    ELECTRON_BUILDER_CACHE: 'D:/pos/.cache/electron-builder',
    WIN_CODE_SIGN_DIR: 'D:/pos/.cache/electron-builder/winCodeSign/winCodeSign-2.6.0',
    WIN_CODE_SIGN_SKIP_EXTRACT: 'true',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    CSC_SKIP: 'true',
    TEMP: 'D:/pos/temp',
    TMP: 'D:/pos/temp'
  };
  execSync('npm run build && electron-builder --win --x64', { stdio: 'inherit', env: newEnv });

  console.log(`\n\x1b[32m[Release]\x1b[0m Build complete for version ${nextVersion}!`);
  console.log(`\x1b[32m[Release]\x1b[0m Installer is in: dist-electron/ZeInfoTech POS Setup ${nextVersion}.exe`);
} catch (error) {
  console.error(`\n\x1b[31m[Release Error]\x1b[0m ${error.message}`);
} finally {
  // 4. Always revert package.json so your dev environment stays on the old version for testing
  pkg.version = originalVersion;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`\x1b[34m[Release]\x1b[0m Workspace reverted to \x1b[1m${originalVersion}\x1b[0m for testing.`);
}
