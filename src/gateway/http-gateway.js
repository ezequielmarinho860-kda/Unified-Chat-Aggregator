const http = require('node:http');

const GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = 47831;
const SNAPSHOT_PATH = '/api/v1/snapshot';

const createHttpGateway = ({
  getSnapshot,
  port = DEFAULT_GATEWAY_PORT,
  createServer = http.createServer,
} = {}) => {
  if (typeof getSnapshot !== 'function') {
    throw new TypeError('HTTP gateway requires getSnapshot().');
  }

  const normalizedPort = normalizePort(port);
  let server;

  const start = async () => {
    if (server?.listening) {
      return getAddress(server);
    }

    server = createServer((request, response) => {
      void handleRequest(request, response, getSnapshot);
    });

    await listen(server, normalizedPort);
    return getAddress(server);
  };

  const stop = async () => {
    if (!server?.listening) {
      server = undefined;
      return;
    }

    const activeServer = server;
    server = undefined;
    await close(activeServer);
  };

  return {
    start,
    stop,
    getAddress: () => (server?.listening ? getAddress(server) : undefined),
  };
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
  GATEWAY_HOST,
  SNAPSHOT_PATH,
  createHttpGateway,
};
