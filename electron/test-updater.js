const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

app.whenReady().then(async () => {
  autoUpdater.logger = console;
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'SahanPramuditha-Dev',
    repo: 'I-Store-Website'
  });

  try {
    const res = await autoUpdater.checkForUpdates();
    console.log('RESULT_VERSION:', res?.updateInfo?.version);
  } catch (err) {
    console.log('CATCH_ERROR:', err.message);
  }
  app.quit();
});
