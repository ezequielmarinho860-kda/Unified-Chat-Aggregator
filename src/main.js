const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { createChatHub } = require('./chat-hub');
const { createMockConnector } = require('./connectors/mock-connector');

const chatHub = createChatHub({
  connectors: [createMockConnector()],
});

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'Unified Chat Aggregator',
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const unsubscribeFromHub = chatHub.onMessage((message) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:message', message);
    }
  });

  mainWindow.on('closed', unsubscribeFromHub);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
};

app.whenReady().then(async () => {
  createMainWindow();
  await chatHub.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await chatHub.stop();
});
