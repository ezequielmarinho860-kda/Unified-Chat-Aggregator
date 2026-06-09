const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_GATEWAY_PORT } = require('../src/gateway/http-gateway');
const { createBrowserBackendConfig } = require('../src/browser-backend/config');

test('creates browser backend config from explicit environment', () => {
  const config = createBrowserBackendConfig({
    env: {
      BROWSER_BACKEND_DATA_DIR: 'C:\\data\\browser-backend',
      BROWSER_BACKEND_PORT: '47899',
      VIEWER_GATEWAY_PORT: '47999',
    },
  });

  assert.equal(config.dataDir, 'C:\\data\\browser-backend');
  assert.equal(config.port, '47899');
});

test('falls back to viewer gateway port and app data directory', () => {
  const config = createBrowserBackendConfig({
    env: {
      APPDATA: 'C:\\Users\\demo\\AppData\\Roaming',
      VIEWER_GATEWAY_PORT: '47999',
    },
  });

  assert.equal(
    config.dataDir,
    path.join('C:\\Users\\demo\\AppData\\Roaming', 'Unified Chat Aggregator', 'browser-backend'),
  );
  assert.equal(config.port, '47999');
});

test('uses default backend port when no port is configured', () => {
  const config = createBrowserBackendConfig({ env: {} });

  assert.equal(config.port, DEFAULT_GATEWAY_PORT);
  assert.match(config.dataDir, /browser-backend$/);
});
