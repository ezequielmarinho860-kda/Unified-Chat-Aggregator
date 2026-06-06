const assert = require('node:assert/strict');
const test = require('node:test');
const {
  clearXSessionAuth,
  getXSessionAuthStatus,
} = require('../src/connectors/x-auth-session');

const createSession = (cookies = []) => {
  const removed = [];
  const cleared = [];

  return {
    removed,
    cleared,
    cookies: {
      get: async () => cookies,
      remove: async (url, name) => {
        removed.push({ url, name });
      },
    },
    clearStorageData: async (options) => {
      cleared.push(options);
    },
  };
};

test('detects an authenticated X browser session from auth_token', async () => {
  const session = createSession([{ name: 'auth_token', domain: '.x.com', path: '/', secure: true }]);

  const status = await getXSessionAuthStatus(session);

  assert.equal(status.connected, true);
});

test('reports disconnected X browser session without auth_token', async () => {
  const session = createSession([{ name: 'ct0', domain: '.x.com', path: '/', secure: true }]);

  const status = await getXSessionAuthStatus(session);

  assert.equal(status.connected, false);
});

test('clears X browser cookies and storage', async () => {
  const session = createSession([
    { name: 'auth_token', domain: '.x.com', path: '/', secure: true },
    { name: 'ct0', domain: '.twitter.com', path: '/', secure: true },
  ]);

  await clearXSessionAuth(session);

  assert.deepEqual(session.removed, [
    { url: 'https://x.com/', name: 'auth_token' },
    { url: 'https://twitter.com/', name: 'ct0' },
  ]);
  assert.equal(session.cleared.length, 2);
  assert.equal(session.cleared[0].origin, 'https://x.com');
  assert.equal(session.cleared[1].origin, 'https://twitter.com');
});
