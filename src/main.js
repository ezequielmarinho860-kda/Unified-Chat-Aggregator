const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const {
  PLATFORM_ORDER,
  clearEnvironmentOverrides,
  createPublicAppConfig,
  createRuntimeAppConfig,
  normalizeAppConfig,
} = require('./app-config');
const { createAppConfigStore } = require('./app-config-store');
const { createBrowserBackendClient } = require('./browser-backend/client');
const { createBrowserBackendRuntime } = require('./browser-backend/runtime');
const { createBrowserBackendStatus } = require('./browser-backend/status');
const { createChatHub } = require('./chat-hub');
const {
  LOCAL_MODERATION_COMMANDS,
  applyModerationCommand,
  requireModerator,
} = require('./local-chat-moderation');
const {
  serializePublicChatMessage,
  serializePublicSnapshot,
  serializePublicStatus,
  serializePublicViewers,
} = require('./public-realtime');
const { createPublicViewerManifestContext } = require('./public-viewer-manifest');
const { createConfiguredConnectorSources } = require('./source-identity');
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

app.commandLine.appendSwitch('log-level', '3');

let setupWindow;
let dashboardWindow;
let configStore;
let savedConfig;
let runtimeConfig;
let envOverrides = [];
let allowEnvironmentOverrides = false;
let chatHub = createChatHub();
let googleOAuthService;
let localChatStore;
let browserBackendClient;
let browserBackendEventsConnection;
let browserBackendRuntime;
let browserBackendStatus = createBrowserBackendStatus();
const displayedLocalMessageIds = new Set();
let unsubscribeHubMessage;
let unsubscribeHubStatus;
let viewerMonitor;

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
    connectors.push(...buildConnectorsForPlatform(config, platform));
  }

  return connectors;
};

const buildConnectorsForPlatform = (config, platform) => {
  const { twitch, kick, x } = config.connectors;
  const platformConfig = config.connectors[platform];
  const sourceEntries = createConfiguredConnectorSources(platform, platformConfig);

  if (platform === 'kick') {
    return sourceEntries.map(({ connectorConfig, index, source }) => attachConnectorSource(createKickConnector({
      channel: connectorConfig.channel,
      chatroomId: index === 0 ? kick.chatroomId || undefined : undefined,
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
    }), source));
  }

  if (platform === 'twitch') {
    return sourceEntries.map(({ connectorConfig, source }) => attachConnectorSource(createTwitchConnector({
      channel: connectorConfig.channel,
      accessToken: twitch.accessToken || undefined,
    }), source));
  }

  if (platform === 'x') {
    return sourceEntries.map(({ connectorConfig, source }) => attachConnectorSource(createXConnector({
      liveUrl: connectorConfig.liveUrl,
      BrowserWindow,
      show: x.showBrowser,
    }), source));
  }

  return [];
};

const attachConnectorSource = (connector, source) => ({
  ...connector,
  source,
});

const wireChatHub = (nextChatHub) => {
  unsubscribeHubMessage?.();
  unsubscribeHubStatus?.();

  unsubscribeHubMessage = nextChatHub.onMessage((message) => {
    broadcastToWindows('chat:message', message);
    publishPublicRealtime('chat.message', () => serializePublicChatMessage(message));
  });
  unsubscribeHubStatus = nextChatHub.onStatus((status) => {
    if (status.platform === 'x' && Object.hasOwn(status.details ?? {}, 'viewerCount')) {
      viewerMonitor?.updateExternalCount(status.source ?? 'x', status.details.viewerCount);
    }

    broadcastToWindows('chat:status', getDisplayStatus(status.platform));
    publishPublicStatus(status);
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
  browserBackendStatus = createBrowserBackendStatus({
    config: runtimeConfig.browserBackend,
    state: browserBackendStatus.state,
  });
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
    await chatHub.replacePlatformConnectors(
      platform,
      buildConnectorsForPlatform(runtimeConfig, platform),
      { replaceExisting: forcePlatforms.includes(platform) },
    );
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
  publishPublicRealtime('snapshot.replace', getPublicRealtimeSnapshot);
};

const broadcastToWindows = (channel, payload) => {
  for (const rendererWindow of rendererWindows) {
    if (!rendererWindow.isDestroyed()) {
      rendererWindow.webContents.send(channel, payload);
    }
  }
};

const getRuntimeSnapshot = () => ({
  browserBackend: browserBackendStatus,
  config: createPublicAppConfig(savedConfig),
  runtimeConfig: createPublicAppConfig(runtimeConfig),
  envOverrides,
  configPath: configStore?.configPath,
  statuses: getDisplayStatuses(),
  viewers: viewerMonitor?.getSnapshot(),
});

const getPublicRealtimeSnapshot = () => {
  const { manifest, sources } = createPublicManifestContext(runtimeConfig);

  return serializePublicSnapshot(
    {
      manifest,
      statuses: chatHub.getStatuses(),
      viewers: viewerMonitor?.getSnapshot(),
    },
    { sources },
  );
};

const createPublicManifestContext = (config = {}) =>
  createPublicViewerManifestContext({
    title: 'Unified Chat Aggregator',
    config,
  });

const createPublicSources = (config = {}) =>
  createPublicManifestContext(config).sources;

const startHttpGateway = async () => {
  try {
    await stopBrowserBackend();
    updateBrowserBackendStatus('connecting');

    if (runtimeConfig.browserBackend.mode === 'external') {
      if (!runtimeConfig.browserBackend.ingestToken) {
        throw new Error('External browser backend requires APP_INGEST_TOKEN.');
      }

      browserBackendClient = createBrowserBackendClient({
        appIngestToken: runtimeConfig.browserBackend.ingestToken,
        baseUrl: runtimeConfig.browserBackend.url,
      });
      await browserBackendClient.loadSnapshot();
      browserBackendEventsConnection = browserBackendClient.connectEvents({
        onError: (error) => console.error(`Browser backend events unavailable: ${error.message}`),
        onEvent: handleBrowserBackendEvent,
      });
      await browserBackendClient.publishAppEvent({
        data: getPublicRealtimeSnapshot(),
        type: 'snapshot.replace',
      });
      updateBrowserBackendStatus('connected');
      console.log(`Connected to external browser backend at ${runtimeConfig.browserBackend.url}`);
      return;
    }

    browserBackendRuntime = createBrowserBackendRuntime({
      dataDir: app.getPath('userData'),
      env: process.env,
      getSnapshot: getPublicRealtimeSnapshot,
      onLocalChatMessage: (message) => publishLocalChatMessage(message),
      port: process.env.VIEWER_GATEWAY_PORT,
    });
    googleOAuthService = browserBackendRuntime.googleOAuthService;
    localChatStore = browserBackendRuntime.localChatStore;
    const gatewayAddress = await browserBackendRuntime.start();

    updateBrowserBackendStatus('connected');
    console.log(`Viewer gateway listening at ${gatewayAddress.snapshotUrl}`);
  } catch (error) {
    browserBackendClient = undefined;
    browserBackendEventsConnection?.close();
    browserBackendEventsConnection = undefined;
    browserBackendRuntime = undefined;
    googleOAuthService = undefined;
    localChatStore = undefined;
    updateBrowserBackendStatus('error', error);
    console.error(`Viewer gateway unavailable: ${error.message}`);
  }
};

const stopBrowserBackend = async () => {
  browserBackendEventsConnection?.close();
  browserBackendEventsConnection = undefined;
  browserBackendClient = undefined;
  googleOAuthService = undefined;
  localChatStore = undefined;
  await browserBackendRuntime?.stop();
  browserBackendRuntime = undefined;
  updateBrowserBackendStatus('stopped');
};

const updateBrowserBackendStatus = (state, error) => {
  browserBackendStatus = createBrowserBackendStatus({
    config: runtimeConfig?.browserBackend,
    error,
    state,
  });
  broadcastToWindows('chat:config', getRuntimeSnapshot());
};

const handleBrowserBackendEvent = (event) => {
  if (event.type === 'chat.message' && event.data?.source?.platform === 'local') {
    publishBackendLocalChatMessage(event.data);
  }
};

const publishBackendLocalChatMessage = (message) => {
  if (message?.id && displayedLocalMessageIds.has(message.id)) {
    return;
  }

  if (message?.id) {
    displayedLocalMessageIds.add(message.id);
    if (displayedLocalMessageIds.size > 500) {
      displayedLocalMessageIds.delete(displayedLocalMessageIds.values().next().value);
    }
  }

  publishLocalChatMessage(message);
};

const publishPublicStatus = (status) => {
  const sources = createPublicSources(runtimeConfig);
  const sourceId = status.source?.sourceId;

  if (sourceId && !sources[sourceId]) {
    return;
  }

  publishPublicRealtime('source.status', () => serializePublicStatus(status, { sources }));
};

const publishPublicViewers = (snapshot) =>
  publishPublicRealtime('viewers.update', () =>
    serializePublicViewers(snapshot, { sources: createPublicSources(runtimeConfig) }));

const publishPublicRealtime = (type, createData) => {
  if (!browserBackendRuntime && !browserBackendClient) {
    return;
  }

  try {
    const data = createData();

    if (browserBackendRuntime) {
      browserBackendRuntime.publish(type, data);
      return;
    }

    void browserBackendClient.publishAppEvent({ data, type }).catch((error) => {
      console.error(`Browser backend app ingestion unavailable: ${error.message}`);
    });
  } catch (error) {
    console.error(`Viewer gateway event unavailable: ${error.message}`);
  }
};

const publishLocalChatMessage = (message, { publishPublic = false } = {}) => {
  broadcastToWindows('chat:message', message);

  if (publishPublic) {
    publishPublicRealtime('chat.message', () => serializePublicChatMessage(message));
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
    const sources = upsertSourceStatus(defaultStatus.details?.sources, status);

    statuses.set(status.platform, {
      ...defaultStatus,
      ...aggregatePlatformStatus(defaultStatus, sources),
      details: {
        ...defaultStatus.details,
        sources,
      },
    });
  }

  return [...statuses.values()];
};

const getDisplayStatus = (platform) =>
  getDisplayStatuses().find((status) => status.platform === platform);

const createDefaultPlatformStatus = (platform, platformConfig = {}) => {
  const enabled = Boolean(platformConfig.enabled);
  const sources = createConfiguredConnectorSources(platform, platformConfig).map(
    ({ source, connectorConfig }) => ({
      source,
      state: 'idle',
      messageCount: 0,
      lastMessageAt: undefined,
      error: undefined,
      details: {
        channel: connectorConfig.channel,
        liveUrl: connectorConfig.liveUrl,
      },
    }),
  );
  const error =
    enabled && sources.length === 0
      ? `${platform === 'x' ? 'X live URL' : 'Channel'} is required.`
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
      sources,
    },
  };
};

const upsertSourceStatus = (previousSources = [], status) => {
  const sourceStatus = createDisplaySourceStatus(status);
  const sources = [...previousSources];
  const index = sources.findIndex(
    (entry) => entry.source?.sourceId === sourceStatus.source?.sourceId,
  );

  if (index === -1) {
    sources.push(sourceStatus);
  } else {
    sources[index] = {
      ...sources[index],
      ...sourceStatus,
      details: {
        ...sources[index].details,
        ...sourceStatus.details,
      },
    };
  }

  return sources;
};

const createDisplaySourceStatus = (status) => ({
  source: status.source,
  state: status.state,
  messageCount: status.messageCount ?? 0,
  lastMessageAt: status.lastMessageAt,
  error: status.error,
  details: status.details ?? {},
});

const aggregatePlatformStatus = (defaultStatus, sources) => {
  const messageCount = sources.reduce((sum, source) => sum + (source.messageCount ?? 0), 0);
  const lastMessageAt = sources
    .map((source) => source.lastMessageAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const error = sources.find((source) => source.error)?.error ?? defaultStatus.error;

  return {
    state: error ? 'error' : aggregateSourceState(defaultStatus.state, sources),
    messageCount,
    lastMessageAt,
    error,
  };
};

const aggregateSourceState = (defaultState, sources) => {
  const states = new Set(sources.map((source) => source.state));

  if (states.has('error')) {
    return 'error';
  }

  if (states.has('connecting')) {
    return 'connecting';
  }

  if (states.has('connected')) {
    return 'connected';
  }

  return defaultState;
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

const registerLocalChatUser = ({ email, nick } = {}) => {
  if (browserBackendClient) {
    return browserBackendClient.registerLocalUser({ email, nick });
  }

  const existingUser = localChatStore.getUserByEmail(email);
  const registeredUser = localChatStore.registerUser({ email, nick });

  if (!existingUser) {
    localChatStore.addModerator({ email: registeredUser.email });
  }

  return createLocalSessionResponse(
    localChatStore.createSession({ email: registeredUser.email }),
  );
};

const loginLocalChatUser = ({ email } = {}) => {
  if (browserBackendClient) {
    return browserBackendClient.loginLocalUser({ email });
  }

  const { session } = localChatStore.createSession({ email });

  return createLocalSessionResponse({
    session,
    user: localChatStore.getSessionUser(session.token),
  });
};

const getLocalChatSession = ({ token } = {}) => {
  if (browserBackendClient) {
    return browserBackendClient.getLocalSession(token);
  }

  const user = requireLocalChatUser(token);

  return { user: serializeLocalUser(user) };
};

const sendLocalChatMessage = ({ token, text } = {}) => {
  if (browserBackendClient) {
    return browserBackendClient.sendLocalMessage({ text, token }).then((result) => {
      publishBackendLocalChatMessage(result.message);
      return result;
    });
  }

  const message = localChatStore.createMessage({ token, text });

  publishLocalChatMessage(message, { publishPublic: true });
  return { message };
};

const runLocalChatModeration = ({ token, command } = {}) => {
  if (browserBackendClient) {
    return browserBackendClient.runLocalModerationCommand({ command, token });
  }

  const user = requireLocalChatUser(token);

  requireModerator(user);
  return { moderation: applyModerationCommand(localChatStore, command, user) };
};

const getLocalChatModerationCommands = () =>
  browserBackendClient
    ? browserBackendClient.getLocalModerationCommands()
    : { commands: LOCAL_MODERATION_COMMANDS };

const getLocalGoogleOAuthStatus = () => ({
  enabled: Boolean(!browserBackendClient && googleOAuthService?.isConfigured()),
});

const startLocalGoogleOAuth = async ({ nick } = {}) => {
  if (!googleOAuthService?.isConfigured()) {
    throw new Error('Google OAuth is not configured.');
  }

  const resultKey = cryptoRandomId();
  const authUrl = googleOAuthService.createAuthorizationUrl({
    resultKey,
    returnTo: 'app',
  });

  await shell.openExternal(authUrl.toString());
  const result = await waitForGoogleOAuthResult(resultKey);

  return completeAppGoogleOAuthResult(result, { nick });
};

const completeLocalGoogleOAuth = ({ nick, ticket } = {}) =>
  browserBackendClient
    ? browserBackendClient.completeGoogleOAuth({ nick, ticket })
    : completeAppGoogleOAuthResult({ ticket }, { nick });

const waitForGoogleOAuthResult = async (resultKey) => {
  const expiresAt = Date.now() + 120_000;

  while (Date.now() < expiresAt) {
    const result = googleOAuthService.consumeResult(resultKey);

    if (result) {
      return result;
    }

    await delay(500);
  }

  throw new Error('Google OAuth login timed out.');
};

const completeAppGoogleOAuthResult = ({ profile, ticket }, { nick } = {}) => {
  const oauthProfile = profile ?? googleOAuthService.consumeTicket(ticket);
  const existingUser = localChatStore.getUserByEmail(oauthProfile.email);

  if (!existingUser && (!nick || typeof nick !== 'string' || nick.trim().length === 0)) {
    if (!profile) {
      throw new Error('Local chat nick is required after Google OAuth.');
    }

    return {
      pendingGoogleOAuth: {
        email: oauthProfile.email,
        name: oauthProfile.name,
        ticket,
      },
    };
  }

  if (profile) {
    googleOAuthService.consumeTicket(ticket);
  }

  const user = existingUser ?? localChatStore.registerUser({ email: oauthProfile.email, nick });

  if (!existingUser) {
    localChatStore.addModerator({ email: user.email });
  }

  return createLocalSessionResponse(
    localChatStore.createSession({ email: user.email }),
  );
};

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const cryptoRandomId = () =>
  `${Date.now()}:${Math.random().toString(36).slice(2)}`;

const requireLocalChatUser = (token) => {
  const user = localChatStore.getSessionUser(token);

  if (!user) {
    throw new Error('Local chat session is invalid.');
  }

  return user;
};

const createLocalSessionResponse = ({ session, user }) => ({
  session: { token: session.token },
  user: serializeLocalUser(user),
});

const serializeLocalUser = (user) => ({
  id: user.id,
  email: user.email,
  nick: user.nick,
  role: user.role,
});

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
    try {
      configStore = createAppConfigStore(path.join(app.getPath('userData'), 'config.json'));
      allowEnvironmentOverrides = !configStore.exists();
      savedConfig = configStore.load();
      applyRuntimeConfig(savedConfig);
      createSetupWindow();

      viewerMonitor = createViewerMonitor({
        getConfig: () => runtimeConfig,
        onUpdate: (snapshot) => {
          broadcastToWindows('viewers:update', snapshot);
          publishPublicViewers(snapshot);
        },
        fetchKick: createRefreshingKickViewerFetcher({
          fetchViewerCount: fetchKickViewerCount,
          refreshAccessToken: (config) => refreshKickAccessToken(config),
          onAuthUpdate: persistKickAuthUpdate,
        }),
      });
      await restartRuntime(savedConfig);
      await startHttpGateway();
      viewerMonitor.start();
    } catch (error) {
      console.error(`App startup failed: ${error.stack ?? error.message}`);
      createSetupWindow();
    }

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
    await stopBrowserBackend();
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

ipcMain.handle('browser-backend:reconnect', async () => {
  await startHttpGateway();
  return getRuntimeSnapshot();
});

ipcMain.handle('dashboard:open', () => {
  openDashboardWindow();
  return { opened: true };
});

ipcMain.handle('chat:send', async (_event, payload) => sendChatMessage(payload));
ipcMain.handle('local-chat:register', (_event, payload) => registerLocalChatUser(payload));
ipcMain.handle('local-chat:login', (_event, payload) => loginLocalChatUser(payload));
ipcMain.handle('local-chat:me', (_event, payload) => getLocalChatSession(payload));
ipcMain.handle('local-chat:send-message', (_event, payload) => sendLocalChatMessage(payload));
ipcMain.handle('local-chat:moderation', (_event, payload) => runLocalChatModeration(payload));
ipcMain.handle('local-chat:moderation-commands', () => getLocalChatModerationCommands());
ipcMain.handle('local-chat:google-status', () => getLocalGoogleOAuthStatus());
ipcMain.handle('local-chat:google-start', (_event, payload) => startLocalGoogleOAuth(payload));
ipcMain.handle('local-chat:google-complete', (_event, payload) => completeLocalGoogleOAuth(payload));

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
