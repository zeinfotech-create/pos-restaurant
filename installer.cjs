const { createWindowsInstaller } = require('electron-winstaller');
const path = require('path');

async function buildInstaller() {
  console.log('Building Squirrel Setup Executable...');
  try {
    await createWindowsInstaller({
      appDirectory: path.join(__dirname, 'dist-app'),
      outputDirectory: path.join(__dirname, 'dist-electron'),
      authors: 'ZeInfoTech',
      exe: 'ZeInfoTechPOS.exe',
      setupExe: 'ZeInfoTechPOS_Setup.exe',
      noMsi: true,
      // You can define an iconUrl here for the final installer icon natively downloading from web
    });
    console.log('Installer built successfully! Check dist-electron/ZeInfoTechPOS_Setup.exe');
  } catch (e) {
    console.log(`Installer failed: ${e.message}`);
  }
}

buildInstaller();
