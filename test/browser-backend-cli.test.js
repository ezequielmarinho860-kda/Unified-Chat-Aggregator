const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createEmptySnapshot,
  startStandaloneBrowserBackend,
} = require('../src/browser-backend/cli');
const { createBrowserBackendClient } = require('../src/browser-backend/client');

const createTempDataDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'uca-browser-backend-cli-'));

test('creates a standalone empty browser backend snapshot', () => {
  const snapshot = createEmptySnapshot();

  assert.equal(snapshot.protocolVersion, '1');
  assert.equal(snapshot.manifest.title, 'Unified Chat Aggregator');
  assert.deepEqual(snapshot.statuses, []);
  assert.deepEqual(snapshot.viewers, { sources: [], total: 0 });
});

test('starts and stops the standalone browser backend cli controller', async () => {
  const dataDir = createTempDataDir();
  const logs = [];
  const controller = await startStandaloneBrowserBackend({
    env: {
      APP_INGEST_TOKEN: 'app-token',
      BROWSER_BACKEND_DATA_DIR: dataDir,
      BROWSER_BACKEND_PORT: '0',
    },
    stdout: (message) => logs.push(message),
  });

  try {
    const response = await fetch(controller.address.snapshotUrl);
    const snapshot = await response.json();

    assert.equal(response.status, 200);
    assert.equal(snapshot.manifest.title, 'Unified Chat Aggregator');
    assert.equal(controller.config.dataDir, dataDir);
    assert.match(logs[0], /Browser backend listening/);
    assert.match(logs[1], /Browser backend data directory/);

    const client = createBrowserBackendClient({
      appIngestToken: 'app-token',
      baseUrl: controller.address.viewerUrl,
    });

    assert.deepEqual(
      await client.publishAppEvent({ data: { sources: [], total: 18 }, type: 'viewers.update' }),
      { accepted: true, published: 0 },
    );
    assert.equal((await client.loadSnapshot()).viewers.total, 18);
  } finally {
    await controller.stop();
  }
});
