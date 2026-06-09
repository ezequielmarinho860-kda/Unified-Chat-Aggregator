#!/usr/bin/env node

const path = require('node:path');
const { createBrowserBackendConfig } = require('./config');
const {
  createBrowserBackendConfigStore,
  createPublicManifestFromBrowserBackendConfig,
} = require('./config-store');
const { createBrowserBackendRuntime } = require('./runtime');
const { createBrowserBackendSnapshotState } = require('./snapshot-state');

const startStandaloneBrowserBackend = async ({
  createRuntime = createBrowserBackendRuntime,
  env = process.env,
  stderr = console.error,
  stdout = console.log,
} = {}) => {
  const config = createBrowserBackendConfig({ env });
  const browserConfigStore = createBrowserBackendConfigStore(
    path.join(config.dataDir, 'browser-config.json'),
  );
  const snapshotState = createBrowserBackendSnapshotState({
    initialSnapshot: createEmptySnapshot({
      manifest: createPublicManifestFromBrowserBackendConfig(browserConfigStore.load()),
    }),
  });
  const runtime = createRuntime({
    appIngestToken: env.APP_INGEST_TOKEN,
    dataDir: config.dataDir,
    env,
    getSnapshot: snapshotState.getSnapshot,
    onAppEvent: snapshotState.applyEvent,
    onBrowserConfigUpdate: (browserConfig) =>
      snapshotState.applyEvent({
        data: createPublicManifestFromBrowserBackendConfig(browserConfig),
        type: 'manifest.update',
      }),
    onExternalConnectorEvent: snapshotState.applyEvent,
    port: config.port,
  });
  const address = await runtime.start();

  stdout(`Browser backend listening at ${address.viewerUrl}`);
  stdout(`Browser backend data directory: ${config.dataDir}`);

  return {
    address,
    config,
    runtime,
    stop: () => stopRuntime(runtime, stderr),
  };
};

const createEmptySnapshot = ({ manifest } = {}) => ({
  generatedAt: new Date().toISOString(),
  manifest: manifest ?? { sources: [], title: 'Unified Chat Aggregator' },
  protocolVersion: '1',
  statuses: [],
  viewers: { sources: [], total: 0 },
});

const stopRuntime = async (runtime, stderr = console.error) => {
  try {
    await runtime.stop();
  } catch (error) {
    stderr(`Browser backend shutdown failed: ${error.message}`);
  }
};

const run = async () => {
  const controller = await startStandaloneBrowserBackend();
  let isStopping = false;

  const stopAndExit = async () => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    await controller.stop();
    process.exit(0);
  };

  process.on('SIGINT', stopAndExit);
  process.on('SIGTERM', stopAndExit);
};

if (require.main === module) {
  run().catch((error) => {
    console.error(`Browser backend failed: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}

module.exports = {
  createEmptySnapshot,
  startStandaloneBrowserBackend,
};
