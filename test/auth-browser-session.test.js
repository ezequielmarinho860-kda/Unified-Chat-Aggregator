const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AUTH_BROWSER_STORAGE_TYPES,
  clearAuthBrowserSession,
} = require('../src/connectors/auth-browser-session');

test('clears persistent auth browser storage and cache', async () => {
  const calls = [];
  const session = {
    clearStorageData: async (options) => calls.push(['storage', options]),
    clearCache: async () => calls.push(['cache']),
  };

  await clearAuthBrowserSession(session);

  assert.deepEqual(calls, [
    ['storage', { storages: AUTH_BROWSER_STORAGE_TYPES }],
    ['cache'],
  ]);
});

test('requires an auth browser session storage API', async () => {
  await assert.rejects(() => clearAuthBrowserSession({}), /storage API/);
});
