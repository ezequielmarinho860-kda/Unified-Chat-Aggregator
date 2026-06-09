#!/usr/bin/env node

const { createBrowserBackendConfig } = require('./config');
const { createBrowserBackendRuntime } = require('./runtime');
const { createBrowserBackendSnapshotState } = require('./snapshot-state');

const startStandaloneBrowserBackend = async ({
  createRuntime = createBrowserBackendRuntime,
  env = process.env,
  stderr = console.error,
  stdout = console.log,
} = {}) => {
  const config = createBrowserBackendConfig({ env });
  const snapshotState = createBrowserBackendSnapshotState({
    initialSnapshot: createEmptySnapshot(),
  });
  const runtime = createRuntime({
    appIngestToken: env.APP_INGEST_TOKEN,
    dataDir: config.dataDir,
    env,
    getSnapshot: snapshotState.getSnapshot,
    onAppEvent: snapshotState.applyEvent,
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

const createEmptySnapshot = () => ({
  generatedAt: new Date().toISOString(),
  manifest: { sources: [], title: 'Unified Chat Aggregator' },
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
