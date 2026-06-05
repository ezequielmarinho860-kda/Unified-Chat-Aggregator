const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { createChatHub } = require('./chat-hub');
const { createKickConnector } = require('./connectors/kick-connector');
const { createMockConnector } = require('./connectors/mock-connector');
const { createTwitchConnector } = require('./connectors/twitch-connector');

const kickChannel = process.env.KICK_CHANNEL || 'xqc';
const kickChatroomId = process.env.KICK_CHATROOM_ID;
const twitchChannel = process.env.TWITCH_CHANNEL || 'monstercat';

const chatHub = createChatHub({
  connectors: [
    createMockConnector(),
    createKickConnector({
      channel: kickChannel,
      chatroomId: kickChatroomId,
    }),
    createTwitchConnector({ channel: twitchChannel }),
  ],
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
