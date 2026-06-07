const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const { createPublicEvent } = require('../public-realtime');

const GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = 47831;
const SNAPSHOT_PATH = '/api/v1/snapshot';
const EVENTS_PATH = '/api/v1/events';
const VIEWER_PATH = '/viewer';
const VIEWER_ASSETS = new Map([
  [VIEWER_PATH, { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  [`${VIEWER_PATH}/`, { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  [`${VIEWER_PATH}/viewer-mode.css`, { file: 'viewer-mode.css', contentType: 'text/css; charset=utf-8' }],
  [`${VIEWER_PATH}/viewer-mode.js`, { file: 'viewer-mode.js', contentType: 'text/javascript; charset=utf-8' }],
  [`${VIEWER_PATH}/assets/twitch-glitch.svg`, {
    file: 'twitch-glitch.svg',
    contentType: 'image/svg+xml; charset=utf-8',
    directory: 'assets',
  }],
]);
const DEFAULT_HEARTBEAT_MS = 30_000;
const VIEWER_ASSET_DIR = path.join(__dirname, '..', 'viewer');
const SHARED_ASSET_DIR = path.join(__dirname, '..', 'assets');

const createHttpGateway = ({
  getSnapshot,
  port = DEFAULT_GATEWAY_PORT,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  createServer = http.createServer,
} = {}) => {
  if (typeof getSnapshot !== 'function') {
    throw new TypeError('HTTP gateway requires getSnapshot().');
  }

  const normalizedPort = normalizePort(port);
  let server;
  let webSocketServer;
  let heartbeatTimer;

  const start = async () => {
    if (server?.listening) {
      return getAddress(server);
    }

    server = createServer((request, response) => {
      void handleRequest(request, response, getSnapshot);
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

const handleRequest = async (request, response, getSnapshot) => {
  const url = new URL(request.url ?? '/', `http://${GATEWAY_HOST}`);

  if (url.pathname === SNAPSHOT_PATH) {
    await handleSnapshotRequest(request, response, getSnapshot);
    return;
  }

  if (VIEWER_ASSETS.has(url.pathname)) {
    await handleViewerAssetRequest(request, response, url.pathname);
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
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

const sendJson = (response, statusCode, body) => {
  const payload = JSON.stringify(body);

  sendResponse(response, statusCode, payload, 'application/json; charset=utf-8');
};

const sendResponse = (response, statusCode, body, contentType) => {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
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
  SNAPSHOT_PATH,
  VIEWER_PATH,
  createHttpGateway,
};
