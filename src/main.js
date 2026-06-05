const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const {
  PLATFORM_ORDER,
  clearEnvironmentOverrides,
  createPublicAppConfig,
  createRuntimeAppConfig,
  normalizeAppConfig,
} = require('./app-config');
const { createAppConfigStore } = require('./app-config-store');
const { createChatHub } = require('./chat-hub');
const {
  resolveKickChannelWithBrowserFallback,
} = require('./connectors/kick-browser-resolver');
const { connectKickWithOAuth } = require('./connectors/kick-auth');
const { connectTwitchWithImplicitOAuth } = require('./connectors/twitch-auth');
const { createKickConnector } = require('./connectors/kick-connector');
const { createTwitchConnector } = require('./connectors/twitch-connector');
const { createXConnector } = require('./connectors/x-connector');

const mainWindows = new Set();
let configStore;
let savedConfig;
let runtimeConfig;
let envOverrides = [];
let allowEnvironmentOverrides = false;
let chatHub = createChatHub();
let unsubscribeHubMessage;
let unsubscribeHubStatus;

const buildConnectors = (config) => {
  const connectors = [];
  const { twitch, kick, x } = config.connectors;

  if (kick.enabled) {
    connectors.push(
      createKickConnector({
        channel: kick.channel,
        chatroomId: kick.chatroomId || undefined,
        accessToken: kick.accessToken || undefined,
        refreshToken: kick.refreshToken || undefined,
        clientId: kick.clientId || undefined,
        clientSecret: kick.clientSecret || undefined,
        oauthBrokerUrl: kick.oauthBrokerUrl || undefined,
        onAuthUpdate: persistKickAuthUpdate,
        resolveChannel: ({ channel, fetchImpl }) =>
          resolveKickChannelWithBrowserFallback({
            channel,
            fetchImpl,
            BrowserWindow,
          }),
      }),
    );
  }

  if (twitch.enabled) {
    connectors.push(
      createTwitchConnector({
        channel: twitch.channel,
        accessToken: twitch.accessToken || undefined,
      }),
    );
  }

  if (x.enabled && x.liveUrl) {
    connectors.push(
      createXConnector({
        liveUrl: x.liveUrl,
        BrowserWindow,
        show: x.showBrowser,
      }),
    );
  }

  return connectors;
};

const wireChatHub = (nextChatHub) => {
  unsubscribeHubMessage?.();
  unsubscribeHubStatus?.();

  unsubscribeHubMessage = nextChatHub.onMessage((message) => {
    broadcastToWindows('chat:message', message);
  });
  unsubscribeHubStatus = nextChatHub.onStatus((status) => {
    broadcastToWindows('chat:status', status);
  });
};

const restartRuntime = async (nextSavedConfig = savedConfig) => {
  savedConfig = normalizeAppConfig(nextSavedConfig);

  await chatHub.stop();

  const appliedConfig = createRuntimeAppConfig(savedConfig, {
    allowEnvironmentOverrides,
    env: process.env,
  });
  runtimeConfig = appliedConfig.runtimeConfig;
  envOverrides = appliedConfig.overrides;
  chatHub = createChatHub({ connectors: buildConnectors(runtimeConfig) });
  wireChatHub(chatHub);
  await chatHub.start();
  broadcastRuntimeSnapshot();
};

const broadcastRuntimeSnapshot = () => {
  const snapshot = getRuntimeSnapshot();

  broadcastToWindows('chat:config', snapshot);
  broadcastToWindows('chat:statuses', snapshot.statuses);
};

const broadcastToWindows = (channel, payload) => {
  for (const mainWindow of mainWindows) {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  }
};

const getRuntimeSnapshot = () => ({
  config: createPublicAppConfig(savedConfig),
  runtimeConfig: createPublicAppConfig(runtimeConfig),
  envOverrides,
  configPath: configStore?.configPath,
  statuses: getDisplayStatuses(),
});

const getDisplayStatuses = () => {
  const statuses = new Map(
    PLATFORM_ORDER.map((platform) => [
      platform,
      createDefaultPlatformStatus(platform, runtimeConfig?.connectors[platform]),
    ]),
  );

  for (const status of chatHub.getStatuses()) {
    const defaultStatus = statuses.get(status.platform) ?? {};

    statuses.set(status.platform, {
      ...defaultStatus,
      ...status,
      details: {
        ...defaultStatus.details,
        ...status.details,
      },
    });
  }

  return [...statuses.values()];
};

const createDefaultPlatformStatus = (platform, platformConfig = {}) => {
  const enabled = Boolean(platformConfig.enabled);
  const error =
    platform === 'x' && enabled && !platformConfig.liveUrl
      ? 'X live URL is required.'
      : undefined;

  return {
    platform,
    state: error ? 'error' : enabled ? 'idle' : 'disabled',
    messageCount: 0,
    lastMessageAt: undefined,
    error,
    details: {
      channel: platformConfig.channel,
      liveUrl: platformConfig.liveUrl,
      authenticatedUser: platformConfig.login,
    },
  };
};

const mergeSavedAuth = (config) => {
  const nextConfig = normalizeAppConfig(config);
  const previousTwitch = savedConfig?.connectors?.twitch ?? {};
  const incomingTwitch = config?.connectors?.twitch ?? {};
  const hasIncomingClientId = Object.hasOwn(incomingTwitch, 'clientId');
  const nextKick = mergeSavedKickAuth(config, nextConfig);

  if (hasIncomingClientId && nextConfig.connectors.twitch.clientId !== previousTwitch.clientId) {
    return normalizeAppConfig({
      ...nextConfig,
      connectors: {
        ...nextConfig.connectors,
        kick: nextKick,
      },
    });
  }

  return normalizeAppConfig({
    ...nextConfig,
    connectors: {
      ...nextConfig.connectors,
      kick: nextKick,
      twitch: {
        ...nextConfig.connectors.twitch,
        clientId: previousTwitch.clientId,
        accessToken: previousTwitch.accessToken,
        userId: previousTwitch.userId,
        login: previousTwitch.login,
        displayName: previousTwitch.displayName,
      },
    },
  });
};

const mergeSavedKickAuth = (config, nextConfig) => {
  const previousKick = savedConfig?.connectors?.kick ?? {};
  const incomingKick = config?.connectors?.kick ?? {};
  const nextKick = nextConfig.connectors.kick;
  const incomingClientSecret =
    typeof incomingKick.clientSecret === 'string' ? incomingKick.clientSecret.trim() : '';
  const clientId = nextKick.clientId;
  const oauthBrokerUrl = nextKick.oauthBrokerUrl || previousKick.oauthBrokerUrl;
  const clientSecret =
    incomingClientSecret ||
    (clientId === previousKick.clientId ? previousKick.clientSecret : '');
  const credentialsChanged =
    clientId !== previousKick.clientId ||
    oauthBrokerUrl !== previousKick.oauthBrokerUrl ||
    (incomingClientSecret.length > 0 && incomingClientSecret !== previousKick.clientSecret);

  return {
    ...nextKick,
    clientId,
    clientSecret,
    oauthBrokerUrl,
    accessToken: credentialsChanged ? '' : previousKick.accessToken,
    refreshToken: credentialsChanged ? '' : previousKick.refreshToken,
    expiresAt: credentialsChanged ? '' : previousKick.expiresAt,
    userId: credentialsChanged ? '' : previousKick.userId,
    login: credentialsChanged ? '' : previousKick.login,
    displayName: credentialsChanged ? '' : previousKick.displayName,
  };
};

const persistKickAuthUpdate = (authPatch) => {
  if (!configStore || !savedConfig?.connectors?.kick) {
    return;
  }

  const nextSavedConfig = configStore.save(
    normalizeAppConfig({
      ...savedConfig,
      connectors: {
        ...savedConfig.connectors,
        kick: {
          ...savedConfig.connectors.kick,
          ...authPatch,
        },
      },
    }),
  );

  savedConfig = nextSavedConfig;
  runtimeConfig = normalizeAppConfig({
    ...runtimeConfig,
    connectors: {
      ...runtimeConfig.connectors,
      kick: {
        ...runtimeConfig.connectors.kick,
        ...authPatch,
      },
    },
  });
  broadcastRuntimeSnapshot();
};

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

  mainWindows.add(mainWindow);

  mainWindow.webContents.once('did-finish-load', () => {
    const snapshot = getRuntimeSnapshot();

    mainWindow.webContents.send('chat:config', snapshot);
    mainWindow.webContents.send('chat:statuses', snapshot.statuses);
  });

  mainWindow.on('closed', () => {
    mainWindows.delete(mainWindow);
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
};

app.whenReady().then(async () => {
  configStore = createAppConfigStore(path.join(app.getPath('userData'), 'config.json'));
  allowEnvironmentOverrides = !configStore.exists();
  savedConfig = configStore.load();
  await restartRuntime(savedConfig);
  createMainWindow();

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

ipcMain.handle('config:get', () => getRuntimeSnapshot());

ipcMain.handle('config:save', async (_event, config) => {
  const nextSavedConfig = configStore.save(mergeSavedAuth(config));

  allowEnvironmentOverrides = false;
  clearEnvironmentOverrides(process.env);
  await restartRuntime(nextSavedConfig);
  return getRuntimeSnapshot();
});

ipcMain.handle('connectors:restart', async () => {
  await restartRuntime(savedConfig);
  return getRuntimeSnapshot();
});

ipcMain.handle('chat:send', async (_event, payload) => chatHub.sendMessage(payload));

ipcMain.handle('twitch:connect', async () => {
  const clientId =
    runtimeConfig?.connectors?.twitch?.clientId || savedConfig?.connectors?.twitch?.clientId;

  if (!clientId) {
    throw new Error('Twitch Client ID is not configured for this build.');
  }

  const auth = await connectTwitchWithImplicitOAuth({
    BrowserWindow,
    clientId,
  });
  const nextSavedConfig = configStore.save({
    ...savedConfig,
    connectors: {
      ...savedConfig.connectors,
      twitch: {
        ...savedConfig.connectors.twitch,
        clientId: auth.clientId,
        accessToken: auth.accessToken,
        userId: auth.userId,
        login: auth.login,
        displayName: auth.displayName,
      },
    },
  });

  allowEnvironmentOverrides = false;
  await restartRuntime(nextSavedConfig);
  return getRuntimeSnapshot();
});

ipcMain.handle('twitch:disconnect', async () => {
  const nextSavedConfig = configStore.save({
    ...savedConfig,
    connectors: {
      ...savedConfig.connectors,
      twitch: {
        ...savedConfig.connectors.twitch,
        accessToken: '',
        userId: '',
        login: '',
        displayName: '',
      },
    },
  });

  allowEnvironmentOverrides = false;
  await restartRuntime(nextSavedConfig);
  return getRuntimeSnapshot();
});

ipcMain.handle('kick:connect', async () => {
  const kickConfig = runtimeConfig?.connectors?.kick ?? savedConfig?.connectors?.kick;
  const clientId = kickConfig?.clientId;
  const clientSecret = kickConfig?.clientSecret;
  const oauthBrokerUrl = kickConfig?.oauthBrokerUrl;

  if (!clientId) {
    throw new Error('Kick Client ID is required.');
  }

  if (!oauthBrokerUrl && !clientSecret) {
    throw new Error('Kick OAuth Broker URL or Client Secret is required.');
  }

  const auth = await connectKickWithOAuth({
    BrowserWindow,
    clientId,
    clientSecret,
    oauthBrokerUrl,
  });
  const nextSavedConfig = configStore.save({
    ...savedConfig,
    connectors: {
      ...savedConfig.connectors,
      kick: {
        ...savedConfig.connectors.kick,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        oauthBrokerUrl: auth.oauthBrokerUrl,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: auth.expiresAt,
        userId: auth.userId,
        login: auth.login,
        displayName: auth.displayName,
      },
    },
  });

  allowEnvironmentOverrides = false;
  await restartRuntime(nextSavedConfig);
  return getRuntimeSnapshot();
});

ipcMain.handle('kick:disconnect', async () => {
  const nextSavedConfig = configStore.save({
    ...savedConfig,
    connectors: {
      ...savedConfig.connectors,
      kick: {
        ...savedConfig.connectors.kick,
        accessToken: '',
        refreshToken: '',
        expiresAt: '',
        userId: '',
        login: '',
        displayName: '',
      },
    },
  });

  allowEnvironmentOverrides = false;
  await restartRuntime(nextSavedConfig);
  return getRuntimeSnapshot();
});

ipcMain.handle('kick:resolve-chatroom', async (_event, channel) =>
  resolveKickChannelWithBrowserFallback({
    channel,
    BrowserWindow,
  }),
);
