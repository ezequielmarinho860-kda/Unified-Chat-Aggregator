const os = require('node:os');
const path = require('node:path');
const { DEFAULT_GATEWAY_PORT } = require('../gateway/http-gateway');

const DEFAULT_APP_DATA_DIR_NAME = 'Unified Chat Aggregator';
const DEFAULT_BACKEND_DATA_DIR_NAME = 'browser-backend';

const createBrowserBackendConfig = ({ env = process.env } = {}) => ({
  dataDir: resolveBackendDataDir(env),
  port: resolveBackendPort(env),
});

const resolveBackendDataDir = (env) => {
  const configuredDataDir = optionalString(env.BROWSER_BACKEND_DATA_DIR);

  if (configuredDataDir) {
    return configuredDataDir;
  }

  const appDataDir = optionalString(env.APPDATA);

  if (appDataDir) {
    return path.join(appDataDir, DEFAULT_APP_DATA_DIR_NAME, DEFAULT_BACKEND_DATA_DIR_NAME);
  }

  return path.join(os.homedir(), '.unified-chat-aggregator', DEFAULT_BACKEND_DATA_DIR_NAME);
};

const resolveBackendPort = (env) =>
  optionalString(env.BROWSER_BACKEND_PORT) ||
  optionalString(env.VIEWER_GATEWAY_PORT) ||
  DEFAULT_GATEWAY_PORT;

const optionalString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

module.exports = {
  createBrowserBackendConfig,
};
