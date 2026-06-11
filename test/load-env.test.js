const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_ENV_FILE, loadProjectEnv } = require('../src/load-env');

test('loads the project .env file through the runtime parser', () => {
  let loadedPath;
  const result = loadProjectEnv({
    loadEnvFile: (filePath) => {
      loadedPath = filePath;
    },
  });

  assert.equal(loadedPath, DEFAULT_ENV_FILE);
  assert.deepEqual(result, { filePath: DEFAULT_ENV_FILE, loaded: true });
  assert.equal(path.basename(DEFAULT_ENV_FILE), '.env');
});

test('allows a missing .env file', () => {
  const filePath = path.join('missing', '.env');
  const result = loadProjectEnv({
    filePath,
    loadEnvFile: () => {
      const error = new Error('missing');

      error.code = 'ENOENT';
      throw error;
    },
  });

  assert.deepEqual(result, { filePath, loaded: false });
});

test('can make the project .env authoritative over stale shell variables', () => {
  const env = { APP_INGEST_TOKEN: 'stale-token' };
  const result = loadProjectEnv({
    env,
    filePath: '.env',
    override: true,
    readFile: () => 'APP_INGEST_TOKEN=project-token\nBROWSER_BACKEND_MODE=external\n',
  });

  assert.deepEqual(result, { filePath: '.env', loaded: true });
  assert.equal(env.APP_INGEST_TOKEN, 'project-token');
  assert.equal(env.BROWSER_BACKEND_MODE, 'external');
});

test('surfaces malformed .env errors', () => {
  assert.throws(
    () => loadProjectEnv({ loadEnvFile: () => { throw new Error('invalid env'); } }),
    /invalid env/,
  );
});
