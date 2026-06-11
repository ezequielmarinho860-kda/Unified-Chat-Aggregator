const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

const DEFAULT_ENV_FILE = path.join(__dirname, '..', '.env');

const loadProjectEnv = ({
  env = process.env,
  filePath = DEFAULT_ENV_FILE,
  loadEnvFile = process.loadEnvFile,
  override = false,
  readFile = fs.readFileSync,
} = {}) => {
  if (override) {
    try {
      Object.assign(env, parseEnv(readFile(filePath, 'utf8')));
      return { filePath, loaded: true };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { filePath, loaded: false };
      }

      throw error;
    }
  }

  if (typeof loadEnvFile !== 'function') {
    throw new Error('This runtime does not support loading .env files.');
  }

  try {
    loadEnvFile(filePath);
    return { filePath, loaded: true };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { filePath, loaded: false };
    }

    throw error;
  }
};

module.exports = {
  DEFAULT_ENV_FILE,
  loadProjectEnv,
};
