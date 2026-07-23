const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

console.log('1. Cleaning previous dist-app...');
if (fs.existsSync('dist-app')) fs.rmSync('dist-app', { recursive: true, force: true });
fs.mkdirSync('dist-app');

console.log('2. Copying Electron base binary from node_modules...');
const electronDist = 'node_modules/electron/dist';
fs.cpSync(electronDist, 'dist-app', { recursive: true });

console.log('3. Renaming electron executable...');
if (fs.existsSync('dist-app/electron.exe')) {
  fs.renameSync('dist-app/electron.exe', 'dist-app/ZeInfoTechPOS.exe');
}

console.log('4. Copying app files...');
const appDir = 'dist-app/resources/app';
fs.mkdirSync(appDir);
fs.cpSync('package.json', path.join(appDir, 'package.json'));
fs.cpSync('dist', path.join(appDir, 'dist'), { recursive: true });
fs.cpSync('electron', path.join(appDir, 'electron'), { recursive: true });

console.log('5. Copying server and portable node...');
fs.cpSync('server', 'dist-app/resources/server', { 
  recursive: true,
  filter: (src) => {
    // Exclude large cache/bin folders optionally, but wait, copying node_modules takes time
    // Let's just copy everything to ensure it works!
    return true; 
  }
});
fs.cpSync('node-portable/node.exe', 'dist-app/resources/node.exe');

console.log('6. Setup complete. dist-app is ready!');
