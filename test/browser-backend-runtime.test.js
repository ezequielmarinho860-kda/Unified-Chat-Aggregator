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
