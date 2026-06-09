const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const {
  createAdminAuth,
  createAdminSessionCookie,
  createExpiredAdminSessionCookie,
  getAdminSessionId,
} = require('./admin-auth');
const {
  LOCAL_MODERATION_COMMANDS,
  applyModerationCommand,
  requireModerator,
} = require('../local-chat-moderation');
const { createPublicEvent, serializePublicChatMessage } = require('../public-realtime');

const GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = 47831;
const SNAPSHOT_PATH = '/api/v1/snapshot';
const EVENTS_PATH = '/api/v1/events';
const APP_EVENTS_PATH = '/api/v1/app/events';
const GOOGLE_AUTH_CALLBACK_PATH = '/api/v1/auth/google/callback';
const GOOGLE_AUTH_COMPLETE_PATH = '/api/v1/auth/google/complete';
const GOOGLE_AUTH_START_PATH = '/api/v1/auth/google/start';
const GOOGLE_AUTH_STATUS_PATH = '/api/v1/auth/google/status';
const LOCAL_LOGIN_PATH = '/api/v1/local/login';
const LOCAL_ME_PATH = '/api/v1/local/me';
const LOCAL_MESSAGES_PATH = '/api/v1/local/messages';
const LOCAL_MODERATION_COMMANDS_PATH = '/api/v1/local/moderation-commands';
const LOCAL_MODERATION_PATH = '/api/v1/local/moderation';
const LOCAL_REGISTER_PATH = '/api/v1/local/register';
const ADMIN_PATH = '/admin';
const ADMIN_LOGIN_PATH = '/api/admin/login';
const ADMIN_LOGOUT_PATH = '/api/admin/logout';
const ADMIN_SESSION_PATH = '/api/admin/session';
const VIEWER_PATH = '/viewer';
const OVERLAY_PATH = '/overlay';
const MAX_JSON_BODY_BYTES = 16 * 1024;
const APP_EVENT_TYPES = new Set([
  'chat.message',
  'manifest.update',
  'snapshot.replace',
  'source.status',
  'viewers.update',
]);
const VIEWER_ASSETS = new Map([
  [VIEWER_PATH, { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  [`${VIEWER_PATH}/`, { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  [`${VIEWER_PATH}/viewer-mode.css`, { file: 'viewer-mode.css', contentType: 'text/css; charset=utf-8' }],
  [`${VIEWER_PATH}/viewer-transport.js`, {
    file: 'viewer-transport.js',
    contentType: 'text/javascript; charset=utf-8',
  }],
  [`${VIEWER_PATH}/viewer-mode.js`, { file: 'viewer-mode.js', contentType: 'text/javascript; charset=utf-8' }],
  [OVERLAY_PATH, { file: 'overlay.html', contentType: 'text/html; charset=utf-8' }],
  [`${OVERLAY_PATH}/`, { file: 'overlay.html', contentType: 'text/html; charset=utf-8' }],
  [`${OVERLAY_PATH}/overlay.css`, { file: 'overlay.css', contentType: 'text/css; charset=utf-8' }],
  [`${OVERLAY_PATH}/overlay.js`, { file: 'overlay.js', contentType: 'text/javascript; charset=utf-8' }],
  [`${VIEWER_PATH}/assets/twitch-glitch.svg`, {
    file: 'twitch-glitch.svg',
    contentType: 'image/svg+xml; charset=utf-8',
    directory: 'assets',
  }],
]);
const ADMIN_ASSETS = new Map([
  [ADMIN_PATH, { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  [`${ADMIN_PATH}/`, { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  [`${ADMIN_PATH}/admin-mode.css`, { file: 'admin-mode.css', contentType: 'text/css; charset=utf-8' }],
  [`${ADMIN_PATH}/admin-mode.js`, { file: 'admin-mode.js', contentType: 'text/javascript; charset=utf-8' }],
]);
const DEFAULT_HEARTBEAT_MS = 30_000;
const VIEWER_ASSET_DIR = path.join(__dirname, '..', 'viewer');
const ADMIN_ASSET_DIR = path.join(__dirname, '..', 'admin');
const SHARED_ASSET_DIR = path.join(__dirname, '..', 'assets');

const createHttpGateway = ({
  adminSessionIdFactory,
  adminToken,
  appIngestToken,
  getSnapshot,
  googleOAuthService,
  localChatStore,
  onAppEvent,
  onLocalChatMessage,
  port = DEFAULT_GATEWAY_PORT,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  createServer = http.createServer,
} = {}) => {
  if (typeof getSnapshot !== 'function') {
    throw new TypeError('HTTP gateway requires getSnapshot().');
  }

  const normalizedPort = normalizePort(port);
  const adminAuth = createAdminAuth({ adminSessionIdFactory, adminToken });
  let server;
  let webSocketServer;
  let heartbeatTimer;

  const start = async () => {
    if (server?.listening) {
      return getAddress(server);
    }

    server = createServer((request, response) => {
      void handleRequest(request, response, {
        getSnapshot,
        adminAuth,
        appIngestToken,
        googleOAuthService,
        localChatStore,
        onAppEvent,
        onLocalChatMessage,
        publish: (type, data) => (webSocketServer ? broadcastEvent(webSocketServer, createPublicEvent(type, data)) : 0),
      });
    });
    webSocketServer = createWebSocketServer(server, getSnapshot);
    heartbeatTimer = setInterval(() => heartbeatClients(webSocketServer), heartbeatMs);

    try {
      await listen(server, normalizedPort);
      return getAddress(server);
    } catch (error) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      server = undefined;
      webSocketServer = undefined;
      throw error;
    }
  };

  const stop = async () => {
    if (!server?.listening) {
      server = undefined;
      return;
    }

    const activeServer = server;
    const activeWebSocketServer = webSocketServer;
    server = undefined;
    webSocketServer = undefined;
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    closeWebSocketClients(activeWebSocketServer);
    await close(activeServer);
    activeWebSocketServer.close();
  };

  const publish = (type, data) => {
    if (!webSocketServer) {
      return 0;
    }

    return broadcastEvent(webSocketServer, createPublicEvent(type, data));
  };

  return {
    start,
    stop,
    publish,
    getAddress: () => (server?.listening ? getAddress(server) : undefined),
  };
};

const createWebSocketServer = (server, getSnapshot) => {
  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${GATEWAY_HOST}`);

    if (url.pathname !== EVENTS_PATH || !isAllowedWebSocketOrigin(request.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client);
    });
  });
  webSocketServer.on('connection', (client) => {
    client.isAlive = true;
    client.on('pong', () => {
      client.isAlive = true;
    });
    void sendInitialSnapshot(client, getSnapshot);
  });

  return webSocketServer;
};

const isAllowedWebSocketOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);

    return ['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname);
  } catch {
    return false;
  }
};

const sendInitialSnapshot = async (client, getSnapshot) => {
  try {
    client.send(JSON.stringify(createPublicEvent('snapshot.replace', await getSnapshot())));
  } catch {
    client.close(1011, 'Snapshot unavailable.');
  }
};

const broadcastEvent = (webSocketServer, event) => {
  const payload = JSON.stringify(event);
  let published = 0;

  for (const client of webSocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      published += 1;
    }
  }

  return published;
};

const heartbeatClients = (webSocketServer) => {
  for (const client of webSocketServer.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }

    client.isAlive = false;
    client.ping();
  }
};

const closeWebSocketClients = (webSocketServer) => {
  for (const client of webSocketServer?.clients ?? []) {
    client.close(1001, 'Gateway stopping.');
  }
};

const handleRequest = async (request, response, context) => {
  const url = new URL(request.url ?? '/', `http://${GATEWAY_HOST}`);

  if (url.pathname === SNAPSHOT_PATH) {
    await handleSnapshotRequest(request, response, context.getSnapshot);
    return;
  }

  if (url.pathname === APP_EVENTS_PATH) {
    await handleAppEventRequest(request, response, context);
    return;
  }

  if (isAdminPath(url.pathname) || ADMIN_ASSETS.has(url.pathname)) {
    await handleAdminRequest(request, response, url.pathname, context.adminAuth);
    return;
  }

  if (isLocalChatPath(url.pathname)) {
    await handleLocalChatRequest(request, response, url.pathname, context);
    return;
  }

  if (isGoogleAuthPath(url.pathname)) {
    await handleGoogleAuthRequest(request, response, url, context);
    return;
  }

  if (VIEWER_ASSETS.has(url.pathname)) {
    await handleViewerAssetRequest(request, response, url.pathname);
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
};

const isAdminPath = (pathname) =>
  [
    ADMIN_PATH,
    `${ADMIN_PATH}/`,
    ADMIN_LOGIN_PATH,
    ADMIN_LOGOUT_PATH,
    ADMIN_SESSION_PATH,
  ].includes(pathname);

const handleAdminRequest = async (request, response, pathname, adminAuth) => {
  try {
    if (!adminAuth.isConfigured()) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (ADMIN_ASSETS.has(pathname)) {
      await handleAdminAssetRequest(request, response, pathname);
      return;
    }

    if (pathname === ADMIN_LOGIN_PATH) {
      requireMethod(request, 'POST');
      const body = await readJsonBody(request);
      const session = adminAuth.createSession(body.token);

      sendJson(
        response,
        200,
        { authenticated: true, role: session.role },
        { 'Set-Cookie': createAdminSessionCookie(session.id) },
      );
      return;
    }

    if (pathname === ADMIN_LOGOUT_PATH) {
      requireMethod(request, 'POST');
      adminAuth.deleteSession(getAdminSessionId(request));
      sendJson(
        response,
        200,
        { authenticated: false },
        { 'Set-Cookie': createExpiredAdminSessionCookie() },
      );
      return;
    }

    if (pathname === ADMIN_SESSION_PATH) {
      requireMethod(request, 'GET');
      const session = adminAuth.getSession(getAdminSessionId(request));

      sendJson(response, 200, {
        authenticated: Boolean(session),
        role: session?.role,
      });
    }
  } catch (error) {
    sendAdminError(response, error);
  }
};

const sendAdminError = (response, error) => {
  const statusCode = error.statusCode ?? 400;

  if (error.allow) {
    response.setHeader('Allow', error.allow);
  }

  sendJson(response, statusCode, {
    error: statusCode >= 500 ? 'Admin request failed.' : error.message,
  });
};

const handleAdminAssetRequest = async (request, response, pathname) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  const asset = ADMIN_ASSETS.get(pathname);

  try {
    const body = await fs.readFile(path.join(ADMIN_ASSET_DIR, asset.file));

    sendResponse(response, 200, body, asset.contentType);
  } catch {
    sendJson(response, 500, { error: 'Admin asset unavailable.' });
  }
};

const handleSnapshotRequest = async (request, response, getSnapshot) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    sendJson(response, 200, await getSnapshot());
  } catch {
    sendJson(response, 500, { error: 'Snapshot unavailable.' });
  }
};

const handleAppEventRequest = async (
  request,
  response,
  { appIngestToken, onAppEvent, publish },
) => {
  if (!appIngestToken) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  try {
    requireMethod(request, 'POST');
    requireBearerToken(request, appIngestToken);
    const body = await readJsonBody(request);
    const event = normalizeAppEvent(body);

    onAppEvent?.(event);
    const published = publish(event.type, event.data);
    sendJson(response, 202, { accepted: true, published });
  } catch (error) {
    sendAppEventError(response, error);
  }
};

const handleViewerAssetRequest = async (request, response, pathname) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  const asset = VIEWER_ASSETS.get(pathname);
  const assetDirectory = asset.directory === 'assets' ? SHARED_ASSET_DIR : VIEWER_ASSET_DIR;

  try {
    const body = await fs.readFile(path.join(assetDirectory, asset.file));

    sendResponse(response, 200, body, asset.contentType);
  } catch {
    sendJson(response, 500, { error: 'Viewer asset unavailable.' });
  }
};

const requireBearerToken = (request, expectedToken) => {
  if (getBearerToken(request) !== expectedToken) {
    const error = new Error('App ingestion token is invalid.');

    error.statusCode = 403;
    throw error;
  }
};

const normalizeAppEvent = (event = {}) => {
  const type = event.type;

  if (!APP_EVENT_TYPES.has(type)) {
    const error = new Error('App ingestion event type is invalid.');

    error.statusCode = 400;
    throw error;
  }

  if (!Object.hasOwn(event, 'data')) {
    const error = new Error('App ingestion event data is required.');

    error.statusCode = 400;
    throw error;
  }

  return {
    data: event.data,
    type,
  };
};

const sendAppEventError = (response, error) => {
  const statusCode = error.statusCode ?? 400;

  if (error.allow) {
    response.setHeader('Allow', error.allow);
  }

  sendJson(response, statusCode, {
    error: statusCode >= 500 ? 'App ingestion failed.' : error.message,
  });
};

const isLocalChatPath = (pathname) =>
  [
    LOCAL_LOGIN_PATH,
    LOCAL_ME_PATH,
    LOCAL_MESSAGES_PATH,
    LOCAL_MODERATION_COMMANDS_PATH,
    LOCAL_MODERATION_PATH,
    LOCAL_REGISTER_PATH,
  ].includes(pathname);

const isGoogleAuthPath = (pathname) =>
  [
    GOOGLE_AUTH_CALLBACK_PATH,
    GOOGLE_AUTH_COMPLETE_PATH,
    GOOGLE_AUTH_START_PATH,
    GOOGLE_AUTH_STATUS_PATH,
  ].includes(pathname);

const handleGoogleAuthRequest = async (
  request,
  response,
  url,
  { googleOAuthService, localChatStore },
) => {
  try {
    if (url.pathname === GOOGLE_AUTH_STATUS_PATH) {
      requireMethod(request, 'GET');
      sendJson(response, 200, { enabled: Boolean(googleOAuthService?.isConfigured() && localChatStore) });
      return;
    }

    if (!googleOAuthService?.isConfigured() || !localChatStore) {
      sendJson(response, 404, { error: 'Google OAuth is not configured.' });
      return;
    }

    if (url.pathname === GOOGLE_AUTH_START_PATH) {
      requireMethod(request, 'GET');
      const authUrl = googleOAuthService.createAuthorizationUrl({
        resultKey: url.searchParams.get('resultKey'),
        returnTo: sanitizeGoogleAuthReturnTo(url.searchParams.get('returnTo')),
      });

      sendRedirect(response, authUrl.toString());
      return;
    }

    if (url.pathname === GOOGLE_AUTH_CALLBACK_PATH) {
      requireMethod(request, 'GET');
      const result = await googleOAuthService.handleCallback({
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
      });

      if (result.returnTo === 'app') {
        sendHtml(response, 200, createGoogleAuthAppSuccessHtml());
        return;
      }

      sendRedirect(response, createGoogleAuthViewerRedirect(result, localChatStore));
      return;
    }

    if (url.pathname === GOOGLE_AUTH_COMPLETE_PATH) {
      requireMethod(request, 'POST');
      const body = await readJsonBody(request);
      const { session, user } = completeGoogleOAuthTicket({
        googleOAuthService,
        localChatStore,
        nick: body.nick,
        ticket: body.ticket,
      });

      sendJson(response, 200, { session: serializeLocalSession(session), user: serializeLocalUser(user) });
    }
  } catch (error) {
    sendLocalChatError(response, error);
  }
};

const createGoogleAuthViewerRedirect = (result, localChatStore) => {
  const returnTo = sanitizeGoogleAuthReturnTo(result.returnTo);
  const existingUser = localChatStore.getUserByEmail(result.profile.email);

  if (existingUser) {
    const { session, user } = localChatStore.createSession({ email: existingUser.email });
    const hash = new URLSearchParams({
      localToken: session.token,
      localUser: JSON.stringify(serializeLocalUser(user)),
    });

    return `${returnTo}#${hash}`;
  }

  const hash = new URLSearchParams({
    oauthEmail: result.profile.email,
    oauthName: result.profile.name ?? '',
    oauthTicket: result.ticket,
  });

  return `${returnTo}#${hash}`;
};

const completeGoogleOAuthTicket = ({ googleOAuthService, localChatStore, nick, ticket }) => {
  const profile = googleOAuthService.consumeTicket(ticket);
  const existingUser = localChatStore.getUserByEmail(profile.email);

  if (!existingUser && (!nick || typeof nick !== 'string' || nick.trim().length === 0)) {
    const error = new Error('Local chat nick is required after Google OAuth.');

    error.statusCode = 400;
    throw error;
  }

  const user = existingUser ?? localChatStore.registerUser({ email: profile.email, nick });
  const sessionResult = localChatStore.createSession({ email: user.email });

  return {
    session: sessionResult.session,
    user: sessionResult.user,
  };
};

const sanitizeGoogleAuthReturnTo = (returnTo) => {
  if (returnTo === 'app') {
    return 'app';
  }

  if (typeof returnTo !== 'string' || returnTo.length === 0) {
    return VIEWER_PATH;
  }

  try {
    const parsed = new URL(returnTo, `http://${GATEWAY_HOST}`);

    if (parsed.origin === `http://${GATEWAY_HOST}` && parsed.pathname.startsWith(VIEWER_PATH)) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return VIEWER_PATH;
  }

  return VIEWER_PATH;
};

const createGoogleAuthAppSuccessHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Google OAuth complete</title>
  </head>
  <body>
    <p>Google login complete. You can close this window and return to the app.</p>
  </body>
</html>`;

const handleLocalChatRequest = async (
  request,
  response,
  pathname,
  { localChatStore, onLocalChatMessage, publish },
) => {
  if (!localChatStore) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  try {
    if (pathname === LOCAL_ME_PATH) {
      requireMethod(request, 'GET');
      const user = requireAuthUser(request, localChatStore);

      sendJson(response, 200, { user: serializeLocalUser(user) });
      return;
    }

    if (pathname === LOCAL_MODERATION_COMMANDS_PATH) {
      requireMethod(request, 'GET');
      sendJson(response, 200, { commands: LOCAL_MODERATION_COMMANDS });
      return;
    }

    requireMethod(request, 'POST');
    const body = await readJsonBody(request);

    if (pathname === LOCAL_REGISTER_PATH) {
      const user = localChatStore.registerUser(body);
      const { session } = localChatStore.createSession({ email: user.email });

      sendJson(response, 201, { session: serializeLocalSession(session), user: serializeLocalUser(user) });
      return;
    }

    if (pathname === LOCAL_LOGIN_PATH) {
      const { session, user } = localChatStore.createSession(body);

      sendJson(response, 200, { session: serializeLocalSession(session), user: serializeLocalUser(user) });
      return;
    }

    const authUser = requireAuthUser(request, localChatStore);

    if (pathname === LOCAL_MESSAGES_PATH) {
      const message = localChatStore.createMessage({ token: getBearerToken(request), text: body.text });
      const publicMessage = serializePublicChatMessage(message);

      onLocalChatMessage?.(message);
      publish('chat.message', publicMessage);
      sendJson(response, 201, { message: publicMessage });
      return;
    }

    if (pathname === LOCAL_MODERATION_PATH) {
      requireModerator(authUser);
      const result = applyModerationCommand(localChatStore, body.command, authUser);

      sendJson(response, 200, { moderation: result });
      return;
    }
  } catch (error) {
    sendLocalChatError(response, error);
  }
};

const requireMethod = (request, method) => {
  if (request.method !== method) {
    const error = new Error('Method not allowed.');

    error.statusCode = 405;
    error.allow = method;
    throw error;
  }
};

const readJsonBody = async (request) => {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_JSON_BODY_BYTES) {
      const error = new Error('Request body is too large.');

      error.statusCode = 413;
      throw error;
    }
  }

  try {
    return body.length > 0 ? JSON.parse(body) : {};
  } catch {
    const error = new Error('Request body must be valid JSON.');

    error.statusCode = 400;
    throw error;
  }
};

const requireAuthUser = (request, localChatStore) => {
  const user = localChatStore.getSessionUser(getBearerToken(request));

  if (!user) {
    const error = new Error('Local chat session is invalid.');

    error.statusCode = 401;
    throw error;
  }

  return user;
};

const getBearerToken = (request) => {
  const authorization = request.headers.authorization ?? '';
  const [, token] = authorization.match(/^Bearer\s+(.+)$/i) ?? [];

  return token ?? '';
};

const serializeLocalUser = (user) => ({
  id: user.id,
  email: user.email,
  nick: user.nick,
  role: user.role,
});

const serializeLocalSession = (session) => ({
  token: session.token,
});

const sendLocalChatError = (response, error) => {
  const statusCode = error.statusCode ?? 400;

  if (error.allow) {
    response.setHeader('Allow', error.allow);
  }

  sendJson(response, statusCode, {
    error: statusCode >= 500 ? 'Local chat request failed.' : error.message,
  });
};

const sendJson = (response, statusCode, body, headers) => {
  const payload = JSON.stringify(body);

  sendResponse(response, statusCode, payload, 'application/json; charset=utf-8', headers);
};

const sendHtml = (response, statusCode, body, headers) => {
  sendResponse(response, statusCode, body, 'text/html; charset=utf-8', headers);
};

const sendRedirect = (response, location) => {
  response.writeHead(302, {
    'Cache-Control': 'no-store',
    Location: location,
    'X-Content-Type-Options': 'nosniff',
  });
  response.end();
};

const sendResponse = (response, statusCode, body, contentType, headers = {}) => {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
};

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, GATEWAY_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

const getAddress = (server) => {
  const address = server.address();

  return {
    host: GATEWAY_HOST,
    port: typeof address === 'object' && address ? address.port : DEFAULT_GATEWAY_PORT,
    snapshotUrl: `http://${GATEWAY_HOST}:${
      typeof address === 'object' && address ? address.port : DEFAULT_GATEWAY_PORT
    }${SNAPSHOT_PATH}`,
    viewerUrl: `http://${GATEWAY_HOST}:${
      typeof address === 'object' && address ? address.port : DEFAULT_GATEWAY_PORT
    }${VIEWER_PATH}`,
    overlayUrl: `http://${GATEWAY_HOST}:${
      typeof address === 'object' && address ? address.port : DEFAULT_GATEWAY_PORT
    }${OVERLAY_PATH}`,
    eventsUrl: `ws://${GATEWAY_HOST}:${
      typeof address === 'object' && address ? address.port : DEFAULT_GATEWAY_PORT
    }${EVENTS_PATH}`,
  };
};

const normalizePort = (port) => {
  const normalized = Number(port);

  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 65535) {
    throw new TypeError('HTTP gateway port must be an integer between 0 and 65535.');
  }

  return normalized;
};

module.exports = {
  DEFAULT_GATEWAY_PORT,
  EVENTS_PATH,
  GATEWAY_HOST,
  OVERLAY_PATH,
  SNAPSHOT_PATH,
  VIEWER_PATH,
  createHttpGateway,
};
