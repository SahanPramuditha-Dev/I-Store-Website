const { spawn } = require('child_process');
const p = spawn('./node_modules/electron/dist/electron.exe', ['test-updater.js']);
p.stdout.on('data', d => console.log('OUT:', d.toString()));
p.stderr.on('data', d => console.log('ERR:', d.toString()));
