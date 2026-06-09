const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const { once } = require('node:events');
const { createBrowserBackendRuntime } = require('../src/browser-backend/runtime');

const createTempDataDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'uca-browser-backend-'));

test('starts a browser backend runtime without Electron', async () => {
  const snapshot = { protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } };
  const runtime = createBrowserBackendRuntime({
    dataDir: createTempDataDir(),
    env: { ADMIN_TOKEN: 'runtime-admin-token' },
    getSnapshot: () => snapshot,
    port: 0,
  });

  try {
    const address = await runtime.start();
    const response = await fetch(address.snapshotUrl);
    const oauthStatus = await fetch(`http://${address.host}:${address.port}/api/v1/auth/google/status`);
    const adminSession = await fetch(`http://${address.host}:${address.port}/api/admin/session`);

    assert.deepEqual(await response.json(), snapshot);
    assert.deepEqual(await oauthStatus.json(), { enabled: false });
    assert.deepEqual(await adminSession.json(), { authenticated: false });
    assert.equal(runtime.address, address);
    assert.equal(runtime.browserConfigStore.load().viewer.title, 'Unified Chat Aggregator');
    assert.equal(typeof runtime.localChatStore.registerUser, 'function');
    assert.equal(runtime.googleOAuthService.isConfigured(), false);
  } finally {
    await runtime.stop();
  }
});

test('publishes browser backend runtime events to connected viewers', async () => {
  const runtime = createBrowserBackendRuntime({
    dataDir: createTempDataDir(),
    env: {},
    getSnapshot: () => ({ protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } }),
    port: 0,
  });
  let client;

  try {
    const address = await runtime.start();

    client = new WebSocket(address.eventsUrl);
    await once(client, 'message');
    const nextMessage = once(client, 'message');

    assert.equal(runtime.publish('viewers.update', { sources: [], total: 12 }), 1);

    const [payload] = await nextMessage;
    const event = JSON.parse(payload.toString());

    assert.equal(event.type, 'viewers.update');
    assert.deepEqual(event.data, { sources: [], total: 12 });
  } finally {
    client?.close();
    await runtime.stop();
  }
});

test('applies browser admin config to backend external connectors', async () => {
  const appliedConfigs = [];
  let externalConnectorOptions;
  let stopCount = 0;
  const dataDir = createTempDataDir();
  const runtime = createBrowserBackendRuntime({
    createExternalConnectors: (options) => {
      externalConnectorOptions = options;

      return {
        applyConfig: async (config) => appliedConfigs.push(config),
        stop: async () => {
          stopCount += 1;
        },
      };
    },
    dataDir,
    env: { ADMIN_TOKEN: 'runtime-admin-token' },
    getSnapshot: () => ({ protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } }),
    port: 0,
  });

  try {
    const address = await runtime.start();
    const loginResponse = await fetch(`http://${address.host}:${address.port}/api/admin/login`, {
      body: JSON.stringify({ token: 'runtime-admin-token' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const sessionCookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const saveResponse = await fetch(`http://${address.host}:${address.port}/api/admin/config`, {
      body: JSON.stringify({
        sources: {
          twitch: [{ channel: 'Monstercat', enabled: true }],
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      method: 'PUT',
    });

    assert.equal(saveResponse.status, 200);
    assert.equal(appliedConfigs.length, 2);
    assert.equal(appliedConfigs[0].viewer.title, 'Unified Chat Aggregator');
    assert.equal(appliedConfigs[1].sources.twitch[0].channel, 'Monstercat');
    assert.equal(externalConnectorOptions.browserDataDir, dataDir);
  } finally {
    await runtime.stop();
  }

  assert.equal(stopCount, 1);
});
