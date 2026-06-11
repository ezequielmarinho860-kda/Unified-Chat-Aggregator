#!/usr/bin/env node

const { createBrowserBackendConfig } = require('./config');
const { createBrowserBackendRuntime } = require('./runtime');
const { createBrowserBackendSnapshotState } = require('./snapshot-state');
const { createRuntimeAppConfig } = require('../app-config');
const { loadProjectEnv } = require('../load-env');
const { createPublicViewerManifestContext } = require('../public-viewer-manifest');

const startStandaloneBrowserBackend = async ({
  createRuntime = createBrowserBackendRuntime,
  env = process.env,
  stderr = console.error,
  stdout = console.log,
} = {}) => {
  const config = createBrowserBackendConfig({ env });
  const snapshotState = createBrowserBackendSnapshotState({
    initialSnapshot: createEmptySnapshot({ env }),
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

const createEmptySnapshot = ({ env = {} } = {}) => ({
  generatedAt: new Date().toISOString(),
  manifest: createStandalonePublicManifest({ env }),
  protocolVersion: '1',
  statuses: [],
  viewers: { sources: [], total: 0 },
});

const createStandalonePublicManifest = ({ env = {} } = {}) => {
  const { runtimeConfig } = createRuntimeAppConfig(createStandaloneBootstrapConfig(), { env });

  return createPublicViewerManifestContext({ config: runtimeConfig }).manifest;
};

const createStandaloneBootstrapConfig = () => ({
  connectors: {
    twitch: {
      enabled: false,
      channel: '',
      sources: [
        { enabled: false, channel: '' },
        { enabled: false, channel: '' },
      ],
    },
    kick: {
      enabled: false,
      channel: '',
      sources: [
        { enabled: false, channel: '' },
        { enabled: false, channel: '' },
      ],
    },
    x: {
      enabled: false,
      liveUrl: '',
      sources: [
        { enabled: false, liveUrl: '' },
        { enabled: false, liveUrl: '' },
      ],
    },
  },
});

const stopRuntime = async (runtime, stderr = console.error) => {
  try {
    await runtime.stop();
  } catch (error) {
    stderr(`Browser backend shutdown failed: ${error.message}`);
  }
};

const run = async () => {
  loadProjectEnv({ override: true });
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
  createStandalonePublicManifest,
  startStandaloneBrowserBackend,
};
