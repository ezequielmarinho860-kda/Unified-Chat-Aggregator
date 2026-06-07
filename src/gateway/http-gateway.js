const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
const { createPublicEvent } = require('../public-realtime');

const GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = 47831;
const SNAPSHOT_PATH = '/api/v1/snapshot';
const EVENTS_PATH = '/api/v1/events';
const DEFAULT_HEARTBEAT_MS = 30_000;

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

  if (url.pathname !== SNAPSHOT_PATH) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

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

const sendJson = (response, statusCode, body) => {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
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
  createHttpGateway,
};
