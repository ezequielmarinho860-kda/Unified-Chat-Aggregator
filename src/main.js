const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { createChatHub } = require('./chat-hub');
const { resolveEnabledConnectors } = require('./connector-config');
const { createKickConnector } = require('./connectors/kick-connector');
const { createMockConnector } = require('./connectors/mock-connector');
const { createTwitchConnector } = require('./connectors/twitch-connector');
const { createXConnector } = require('./connectors/x-connector');

const kickChannel = process.env.KICK_CHANNEL || 'xqc';
const kickChatroomId = process.env.KICK_CHATROOM_ID;
const twitchChannel = process.env.TWITCH_CHANNEL || 'monstercat';
const xLiveUrl = process.env.X_LIVE_URL;
const enabledConnectors = resolveEnabledConnectors(process.env.CONNECTORS, {
  includeXWhenConfigured: Boolean(xLiveUrl),
});

const connectorFactories = {
  mock: () => createMockConnector(),
  kick: () => createKickConnector({
    channel: kickChannel,
    chatroomId: kickChatroomId,
  }),
  twitch: () => createTwitchConnector({ channel: twitchChannel }),
  x: () => {
    if (!xLiveUrl) {
      throw new TypeError('X_LIVE_URL is required when CONNECTORS includes x.');
    }

    return createXConnector({
      liveUrl: xLiveUrl,
      BrowserWindow,
      show: process.env.X_SHOW_BROWSER === 'true',
    });
  },
};

const connectors = enabledConnectors.map((connector) => connectorFactories[connector]());

const chatHub = createChatHub({
  connectors,
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
