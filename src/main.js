const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const {
  PLATFORM_ORDER,
  clearEnvironmentOverrides,
  createPublicAppConfig,
  createRuntimeAppConfig,
  normalizeAppConfig,
} = require('./app-config');
const { createAppConfigStore } = require('./app-config-store');
const { createChatHub } = require('./chat-hub');
const { createHttpGateway } = require('./gateway/http-gateway');
const { serializePublicSnapshot } = require('./public-realtime');
const { createConnectorSource } = require('./source-identity');
const { createViewerMonitor } = require('./viewer-monitor');
const {
  createRefreshingKickViewerFetcher,
  fetchKickViewerCount,
} = require('./viewer-counts');
const {
  resolveKickChannelWithBrowserFallback,
} = require('./connectors/kick-browser-resolver');
const { resolveKickChatroomForConfig } = require('./connectors/kick-config-resolver');
const { clearAuthBrowserSession } = require('./connectors/auth-browser-session');
const { connectKickWithOAuth, KICK_AUTH_PARTITION } = require('./connectors/kick-auth');
const { refreshKickAccessToken } = require('./connectors/kick-api');
const {
  connectTwitchWithImplicitOAuth,
  TWITCH_AUTH_PARTITION,
} = require('./connectors/twitch-auth');
const { createKickConnector } = require('./connectors/kick-connector');
const { createTwitchConnector } = require('./connectors/twitch-connector');
const {
  createXConnector,
  isXComposerUnavailableError,
  X_CAPTURE_PARTITION,
} = require('./connectors/x-connector');
const { clearXSessionAuth, getXSessionAuthStatus } = require('./connectors/x-auth-session');

const rendererWindows = new Set();
const CONNECTOR_PLATFORMS = ['kick', 'twitch', 'x'];
let setupWindow;
let dashboardWindow;
let configStore;
let savedConfig;
let runtimeConfig;
let envOverrides = [];
let allowEnvironmentOverrides = false;
let chatHub = createChatHub();
let unsubscribeHubMessage;
let unsubscribeHubStatus;
let viewerMonitor;
let httpGateway;

const focusWindow = (window) => {
  if (!window || window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
};

const buildConnectors = (config) => {
  const connectors = [];

  for (const platform of CONNECTOR_PLATFORMS) {
    const connector = buildConnectorForPlatform(config, platform);

    if (connector) {
      connectors.push(connector);
    }
  }

  return connectors;
};

const buildConnectorForPlatform = (config, platform) => {
  const { twitch, kick, x } = config.connectors;

  if (platform === 'kick' && kick.enabled) {
    return createKickConnector({
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
    });
  }

  if (platform === 'twitch' && twitch.enabled) {
    return createTwitchConnector({
      channel: twitch.channel,
      accessToken: twitch.accessToken || undefined,
    });
  }

  if (platform === 'x' && x.enabled && x.liveUrl) {
    return createXConnector({
      liveUrl: x.liveUrl,
      BrowserWindow,
      show: x.showBrowser,
    });
  }

  return undefined;
};

const wireChatHub = (nextChatHub) => {
  unsubscribeHubMessage?.();
  unsubscribeHubStatus?.();

  unsubscribeHubMessage = nextChatHub.onMessage((message) => {
    broadcastToWindows('chat:message', message);
  });
  unsubscribeHubStatus = nextChatHub.onStatus((status) => {
    if (status.platform === 'x' && Object.hasOwn(status.details ?? {}, 'viewerCount')) {
      viewerMonitor?.updateExternalCount('x', status.details.viewerCount);
    }

    broadcastToWindows('chat:status', status);
  });
};

const restartRuntime = async (nextSavedConfig = savedConfig) => {
  await chatHub.stop();
  applyRuntimeConfig(nextSavedConfig);
  viewerMonitor?.updateExternalCount('x', undefined);

  chatHub = createChatHub({ connectors: buildConnectors(runtimeConfig) });
  wireChatHub(chatHub);
  await chatHub.start();
  broadcastRuntimeSnapshot();
  void viewerMonitor?.refresh();
};

const applyRuntimeConfig = (nextSavedConfig) => {
  savedConfig = normalizeAppConfig(nextSavedConfig);

  const appliedConfig = createRuntimeAppConfig(savedConfig, {
    allowEnvironmentOverrides,
    env: process.env,
  });
  runtimeConfig = appliedConfig.runtimeConfig;
  envOverrides = appliedConfig.overrides;
};

const restartChangedConnectors = async (nextSavedConfig, forcePlatforms = []) => {
  const previousRuntimeConfig = runtimeConfig;

  applyRuntimeConfig(nextSavedConfig);

  const changedPlatforms =
    forcePlatforms.length > 0
      ? forcePlatforms
      : getChangedConnectorPlatforms(previousRuntimeConfig, runtimeConfig);

  if (changedPlatforms.includes('x')) {
    viewerMonitor?.updateExternalCount('x', undefined);
  }

  for (const platform of changedPlatforms) {
    const connector = buildConnectorForPlatform(runtimeConfig, platform);

    if (connector) {
      await chatHub.replaceConnector(connector);
    } else {
      await chatHub.removeConnector(platform);
    }
  }

  broadcastRuntimeSnapshot();
  void viewerMonitor?.refresh();
};

const getChangedConnectorPlatforms = (previousConfig, nextConfig) =>
  CONNECTOR_PLATFORMS.filter(
    (platform) =>
      JSON.stringify(previousConfig?.connectors?.[platform] ?? {}) !==
      JSON.stringify(nextConfig?.connectors?.[platform] ?? {}),
  );

const broadcastRuntimeSnapshot = () => {
  const snapshot = getRuntimeSnapshot();

  broadcastToWindows('chat:config', snapshot);
  broadcastToWindows('chat:statuses', snapshot.statuses);
};

const broadcastToWindows = (channel, payload) => {
  for (const rendererWindow of rendererWindows) {
    if (!rendererWindow.isDestroyed()) {
      rendererWindow.webContents.send(channel, payload);
    }
  }
};

const getRuntimeSnapshot = () => ({
  config: createPublicAppConfig(savedConfig),
  runtimeConfig: createPublicAppConfig(runtimeConfig),
  envOverrides,
  configPath: configStore?.configPath,
  statuses: getDisplayStatuses(),
  viewers: viewerMonitor?.getSnapshot(),
});

const getPublicRealtimeSnapshot = () => {
  const sources = createPublicSources(runtimeConfig);

  return serializePublicSnapshot(
    {
      manifest: { title: 'Unified Chat Aggregator' },
      statuses: getDisplayStatuses(),
      viewers: viewerMonitor?.getSnapshot(),
    },
    { sources },
  );
};

const createPublicSources = (config = {}) =>
  Object.fromEntries(
    PLATFORM_ORDER.flatMap((platform) => {
      const connectorConfig = config.connectors?.[platform];

      if (!connectorConfig?.enabled) {
        return [];
      }

      const source = createConnectorSource({ platform, ...connectorConfig });
      return source ? [[platform, source]] : [];
    }),
  );

const startHttpGateway = async () => {
  try {
    httpGateway = createHttpGateway({
      getSnapshot: getPublicRealtimeSnapshot,
      port: process.env.VIEWER_GATEWAY_PORT,
    });
    const gatewayAddress = await httpGateway.start();

    console.log(`Viewer gateway listening at ${gatewayAddress.snapshotUrl}`);
  } catch (error) {
    httpGateway = undefined;
    console.error(`Viewer gateway unavailable: ${error.message}`);
  }
};

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
    chatroomId:
      nextKick.channel === previousKick.channel && !Object.hasOwn(incomingKick, 'chatroomId')
        ? previousKick.chatroomId
        : nextKick.chatroomId,
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

const openXLoginWindow = async () => {
  const loginWindow = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: 'Connect X',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: X_CAPTURE_PARTITION,
    },
  });

  await loginWindow.loadURL('https://x.com/login');

  return {
    opened: true,
    partition: X_CAPTURE_PARTITION,
    auth: await getXAuthStatus(),
  };
};

const getXAuthStatus = () => getXSessionAuthStatus(session.fromPartition(X_CAPTURE_PARTITION));

const disconnectXSession = async () => {
  await clearXSessionAuth(session.fromPartition(X_CAPTURE_PARTITION));
  await restartChangedConnectors(savedConfig, ['x']);

  return getRuntimeSnapshot();
};

const clearAuthPartition = (partition) =>
  clearAuthBrowserSession(session.fromPartition(partition));

const sendChatMessage = async (payload) => {
  try {
    return await chatHub.sendMessage(payload);
  } catch (error) {
    if (isXComposerUnavailableError(error)) {
      console.warn(`[X send] ${error.message}`);
      return {
        ok: false,
        code: error.code,
        error: error.message,
      };
    }

    throw error;
  }
};

const createRendererWindow = ({ view, windowOptions }) => {
  const rendererWindow = new BrowserWindow({
    backgroundColor: savedConfig?.ui?.theme === 'dark' ? '#111418' : '#f6f4ef',
    ...windowOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  rendererWindows.add(rendererWindow);

  rendererWindow.webContents.once('did-finish-load', () => {
    const snapshot = getRuntimeSnapshot();

    rendererWindow.webContents.send('chat:config', snapshot);
    rendererWindow.webContents.send('chat:statuses', snapshot.statuses);
    rendererWindow.webContents.send('viewers:update', snapshot.viewers);
  });

  rendererWindow.on('closed', () => {
    rendererWindows.delete(rendererWindow);
  });

  rendererWindow.loadFile(path.join(__dirname, `${view}.html`));

  return rendererWindow;
};

const createSetupWindow = () => {
  if (setupWindow && !setupWindow.isDestroyed()) {
    focusWindow(setupWindow);
    return setupWindow;
  }

  setupWindow = createRendererWindow({
    view: 'setup',
    windowOptions: {
      width: 1120,
      height: 760,
      minWidth: 760,
      minHeight: 560,
      title: 'Connector Setup',
    },
  });
  setupWindow.on('closed', () => {
    setupWindow = undefined;
  });

  return setupWindow;
};

const openDashboardWindow = () => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    focusWindow(dashboardWindow);
    return dashboardWindow;
  }

  dashboardWindow = createRendererWindow({
    view: 'dashboard',
    windowOptions: {
      width: 1120,
      height: 760,
      minWidth: 420,
      minHeight: 480,
      title: 'Unified Chat Dashboard',
    },
  });
  dashboardWindow.on('closed', () => {
    dashboardWindow = undefined;
  });

  return dashboardWindow;
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusWindow(setupWindow ?? dashboardWindow);
  });

  app.whenReady().then(async () => {
    configStore = createAppConfigStore(path.join(app.getPath('userData'), 'config.json'));
    allowEnvironmentOverrides = !configStore.exists();
    savedConfig = configStore.load();
    viewerMonitor = createViewerMonitor({
      getConfig: () => runtimeConfig,
      onUpdate: (snapshot) => broadcastToWindows('viewers:update', snapshot),
      fetchKick: createRefreshingKickViewerFetcher({
        fetchViewerCount: fetchKickViewerCount,
        refreshAccessToken: (config) => refreshKickAccessToken(config),
        onAuthUpdate: persistKickAuthUpdate,
      }),
    });
    await restartRuntime(savedConfig);
    await startHttpGateway();
    viewerMonitor.start();
    createSetupWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createSetupWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', async () => {
    viewerMonitor?.stop();
    await httpGateway?.stop();
    await chatHub.stop();
  });
}

ipcMain.handle('config:get', () => getRuntimeSnapshot());

ipcMain.handle('config:save', async (_event, config) => {
  const mergedConfig = mergeSavedAuth(config);
  const resolvedConfig = await resolveKickChatroomForConfig({
    config: mergedConfig,
    previousConfig: savedConfig,
    resolveChannel: ({ channel }) =>
      resolveKickChannelWithBrowserFallback({
        channel,
        BrowserWindow,
      }),
  });
  const nextSavedConfig = configStore.save(resolvedConfig);

  allowEnvironmentOverrides = false;
  clearEnvironmentOverrides(process.env);
  await restartChangedConnectors(nextSavedConfig);
  return getRuntimeSnapshot();
});

ipcMain.handle('connectors:restart', async () => {
  await restartRuntime(savedConfig);
  return getRuntimeSnapshot();
});

ipcMain.handle('dashboard:open', () => {
  openDashboardWindow();
  return { opened: true };
});

ipcMain.handle('chat:send', async (_event, payload) => sendChatMessage(payload));

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
  await restartChangedConnectors(nextSavedConfig, ['twitch']);
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
  await restartChangedConnectors(nextSavedConfig, ['twitch']);
  return getRuntimeSnapshot();
});

ipcMain.handle('twitch:clear-auth-session', async () => {
  await clearAuthPartition(TWITCH_AUTH_PARTITION);
  return { cleared: true };
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
  await restartChangedConnectors(nextSavedConfig, ['kick']);
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
  await restartChangedConnectors(nextSavedConfig, ['kick']);
  return getRuntimeSnapshot();
});

ipcMain.handle('kick:clear-auth-session', async () => {
  await clearAuthPartition(KICK_AUTH_PARTITION);
  return { cleared: true };
});

ipcMain.handle('x:connect', async () => openXLoginWindow());
ipcMain.handle('x:auth-status', async () => getXAuthStatus());
ipcMain.handle('x:disconnect', async () => disconnectXSession());
