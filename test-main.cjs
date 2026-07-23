const { app } = require('electron');
const fs = require('fs');
fs.writeFileSync('test-main-debug.txt', 'TEST MAIN WORKED\n');
app.quit();
