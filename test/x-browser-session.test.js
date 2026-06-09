const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createXBrowserProfileDirForLiveUrl,
  openXBrowserLoginSession,
  resolveBrowserExecutablePath,
} = require('../src/browser-backend/x-browser-session');

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'uca-x-browser-session-'));

test('creates stable X browser profile dirs from handles and live URLs', () => {
  const dataDir = createTempDir();

  assert.equal(
    createXBrowserProfileDirForLiveUrl(dataDir, '@Jugguer_'),
    path.join(dataDir, 'x-browser-profile', 'x-jugguer_'),
  );
  assert.equal(
    createXBrowserProfileDirForLiveUrl(dataDir, 'https://x.com/i/broadcasts/123'),
    path.join(dataDir, 'x-browser-profile', 'x-broadcast-123'),
  );
});

test('rejects invalid X browser login sources', () => {
  assert.throws(
    () => createXBrowserProfileDirForLiveUrl(createTempDir(), 'https://example.com/live'),
    /x\.com|twitter\.com/,
  );
  assert.throws(
    () => createXBrowserProfileDirForLiveUrl(createTempDir(), 'not a handle'),
    /X URL or handle/,
  );
});

test('opens Chrome or Edge with the dedicated X browser profile', () => {
  const dataDir = createTempDir();
  const executablePath = path.join(dataDir, 'chrome.exe');
  const spawnCalls = [];

  fs.writeFileSync(executablePath, '');

  const result = openXBrowserLoginSession({
    browserDataDir: dataDir,
    browserExecutablePath: executablePath,
    liveUrl: '@Jugguer_',
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ args, command, options });
      return { unref() {} };
    },
  });

  assert.equal(result.opened, true);
  assert.equal(result.url, 'https://x.com');
  assert.equal(result.profileDir, path.join(dataDir, 'x-browser-profile', 'x-jugguer_'));
  assert.equal(fs.existsSync(result.profileDir), true);
  assert.equal(spawnCalls[0].command, executablePath);
  assert.deepEqual(spawnCalls[0].args, [
    `--user-data-dir=${result.profileDir}`,
    'https://x.com',
  ]);
  assert.equal(spawnCalls[0].options.detached, true);
  assert.equal(spawnCalls[0].options.stdio, 'ignore');
});

test('requires a backend data directory to open X browser login', () => {
  assert.throws(
    () => openXBrowserLoginSession({
      browserExecutablePath: path.join(createTempDir(), 'chrome.exe'),
      liveUrl: '@Jugguer_',
    }),
    /backend data directory/,
  );
});

test('resolves explicit browser executable paths before environment defaults', () => {
  const dataDir = createTempDir();
  const explicitPath = path.join(dataDir, 'chrome.exe');
  const envPath = path.join(dataDir, 'edge.exe');

  fs.writeFileSync(explicitPath, '');
  fs.writeFileSync(envPath, '');

  assert.equal(
    resolveBrowserExecutablePath({
      browserExecutablePath: explicitPath,
      env: { BROWSER_BACKEND_X_BROWSER_PATH: envPath },
    }),
    explicitPath,
  );
});
