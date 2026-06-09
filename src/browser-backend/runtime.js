const path = require('node:path');
const { createHttpGateway, DEFAULT_GATEWAY_PORT } = require('../gateway/http-gateway');
const { createGoogleOAuthService } = require('../google-oauth');
const { createLocalChatStore } = require('../local-chat-store');
const { createBrowserBackendConfigStore } = require('./config-store');

const createBrowserBackendRuntime = ({
  dataDir,
  env = process.env,
  adminToken = env.ADMIN_TOKEN,
  appIngestToken = env.APP_INGEST_TOKEN,
  getSnapshot,
  browserConfigFileName = 'browser-config.json',
  localChatFileName = 'local-chat.json',
  onAppEvent,
  onBrowserConfigUpdate,
  onLocalChatMessage,
  port = env.BROWSER_BACKEND_PORT ?? env.VIEWER_GATEWAY_PORT,
} = {}) => {
  if (typeof dataDir !== 'string' || dataDir.length === 0) {
    throw new TypeError('Browser backend runtime requires a data directory.');
  }

  if (typeof getSnapshot !== 'function') {
    throw new TypeError('Browser backend runtime requires getSnapshot().');
  }

  const normalizedPort = normalizeGatewayPort(port);
  const localChatStore = createLocalChatStore({
    filePath: path.join(dataDir, localChatFileName),
  });
  const browserConfigStore = createBrowserBackendConfigStore(
    path.join(dataDir, browserConfigFileName),
  );
  const googleOAuthService = createGoogleOAuthService({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri:
      env.GOOGLE_OAUTH_REDIRECT_URI ||
      `http://127.0.0.1:${normalizedPort || DEFAULT_GATEWAY_PORT}/api/v1/auth/google/callback`,
  });
  let gateway;
  let address;

  const start = async () => {
    if (gateway) {
      return address;
    }

    gateway = createHttpGateway({
      adminToken,
      appIngestToken,
      browserConfigStore,
      getSnapshot,
      googleOAuthService,
      localChatStore,
      onAppEvent,
      onBrowserConfigUpdate,
      onLocalChatMessage,
      port: normalizedPort,
    });

    try {
      address = await gateway.start();
      return address;
    } catch (error) {
      gateway = undefined;
      address = undefined;
      throw error;
    }
  };

  const stop = async () => {
    await gateway?.stop();
    gateway = undefined;
    address = undefined;
  };

  const publish = (type, data) => gateway?.publish(type, data) ?? 0;

  return {
    get address() {
      return address;
    },
    browserConfigStore,
    googleOAuthService,
    localChatStore,
    publish,
    start,
    stop,
  };
};

const normalizeGatewayPort = (port) => {
  if (port === undefined || port === null || port === '') {
    return DEFAULT_GATEWAY_PORT;
  }

  return port;
};

module.exports = {
  createBrowserBackendRuntime,
};
