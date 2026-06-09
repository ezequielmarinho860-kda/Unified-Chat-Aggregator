const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserBackendStatus } = require('../src/browser-backend/status');

const fixedNow = () => new Date('2026-06-09T12:00:00.000Z');

test('creates a public browser backend status without exposing tokens', () => {
  const status = createBrowserBackendStatus({
    config: {
      ingestToken: 'secret-token',
      mode: 'external',
      url: 'http://127.0.0.1:47831',
    },
    now: fixedNow,
    state: 'connected',
  });

  assert.deepEqual(status, {
    ingestConfigured: true,
    mode: 'external',
    state: 'connected',
    updatedAt: '2026-06-09T12:00:00.000Z',
    url: 'http://127.0.0.1:47831',
  });
  assert.doesNotMatch(JSON.stringify(status), /secret-token/);
});

test('normalizes browser backend errors and fallback values', () => {
  assert.deepEqual(
    createBrowserBackendStatus({
      config: { mode: 'unknown' },
      error: new Error('Backend unavailable.'),
      now: fixedNow,
      state: 'bad-state',
    }),
    {
      error: 'Backend unavailable.',
      ingestConfigured: false,
      mode: 'embedded',
      state: 'stopped',
      updatedAt: '2026-06-09T12:00:00.000Z',
    },
  );
});
