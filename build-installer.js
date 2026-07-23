import { createWindowsInstaller } from 'electron-winstaller';
import path from 'path';

async function build() {
  console.log('Building installer...');
  try {
    await createWindowsInstaller({
      appDirectory: './dist-packaged/ZeInfoTech POS-win32-x64',
      outputDirectory: './dist-installer',
      authors: 'ZeInfoTech',
      exe: 'ZeInfoTech POS.exe',
      description: 'ZeInfoTech POS Desktop App',
      productName: 'ZeInfoTech POS',
      noMsi: true,
    });
    console.log('Installer built successfully!');
  } catch (e) {
    console.error('Failed to build installer:', e.message);
  }
}

build();
