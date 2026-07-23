const fs = require('fs');
const path = require('path');

// Go up one level from 'scripts' to the root where package.json is
const packagePath = path.join(__dirname, '..', 'package.json');

try {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  // Split version e.g. "1.0.0" -> [1, 0, 0]
  const versionParts = pkg.version.split('.').map(Number);
  
  if (versionParts.length !== 3 || versionParts.some(isNaN)) {
    throw new Error('Invalid version format in package.json');
  }

  // Increment the patch version (the last number)
  versionParts[2] += 1;
  
  const newVersion = versionParts.join('.');
  pkg.version = newVersion;

  // Write back to package.json with 2-space indentation
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  
  console.log(`\x1b[32m[Version Bump]\x1b[0m Successfully updated version to: \x1b[1m${newVersion}\x1b[0m`);
} catch (error) {
  console.error(`\x1b[31m[Version Bump Error]\x1b[0m ${error.message}`);
  process.exit(1);
}
