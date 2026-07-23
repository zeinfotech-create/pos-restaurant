const packager = require('electron-packager');
const { createWindowsInstaller } = require('electron-winstaller');
const path = require('path');
const fs = require('fs-extra'); // We can use fs-extra if available, or just fs.promises

async function buildApp() {
  console.log('1. Fetching portable node...');
  // We already downloaded portable node into node-portable!

  console.log('2. Running electron-packager...');
  const appPaths = await packager({
    dir: '.',
    out: 'dist-app',
    name: 'ZeInfoTechPOS',
    platform: 'win32',
    arch: 'x64',
    asar: {
      unpackDir: "server"
    },
    overwrite: true,
    ignore: [
      /^\/\.git/,
      /^\/dist-electron/,
      /^\/dist-app/,
      // Packager might take a while if we don't ignore dev dependencies, but that's fine.
    ]
  });

  const appPath = appPaths[0];
  console.log(`Packaged app at ${appPath}`);

  console.log('3. Copying bundled Node and Server...');
  // We need to copy `node-portable/node.exe` into the packaged `resources`
  // We also need to copy `server` into the packaged `resources`. But `packager` already copied everything!
  // Wait, `packager` copies the whole directory unless ignored. So `server` is already there. Wait, it's inside `resources/app.asar`!
  // Oh, right, we spawned `node resources/app/server/index.js`? Wait, earlier main.cjs was looking at `process.resourcesPath`, `server/index.js`.
  
  // To match main.cjs paths: we need `resources/server` and `resources/node.exe`.
  const resourcesPath = path.join(appPath, 'resources');
  // Copy node.exe to both root and resources for maximum reliability
  const fs = require('fs');
  fs.copyFileSync('node-portable/node.exe', path.join(appPath, 'node.exe'));
  fs.copyFileSync('node-portable/node.exe', path.join(resourcesPath, 'node.exe'));

  // The packager put everything in app.asar. 
  // We used unpackDir: "server", so it's also in resources/app.asar.unpacked/server
  
  console.log('4. Creating Windows Installer...');
  try {
    await createWindowsInstaller({
      appDirectory: appPath,
      outputDirectory: 'dist-electron',
      authors: 'ZeInfoTech',
      exe: 'ZeInfoTechPOS.exe',
      setupExe: 'ZeInfoTechPOS_Setup.exe',
      noMsi: true,
    });
    console.log('Installer built successfully! Check dist-electron/');
  } catch (e) {
    console.log(`Installer failed: ${e.message}`);
  }
}

buildApp().catch(err => {
  console.error(err);
  process.exit(1);
});
