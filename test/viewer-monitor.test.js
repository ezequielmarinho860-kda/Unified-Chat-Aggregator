const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculateAdaptivePollMs,
  calculateFixedCadenceDelay,
  createViewerMonitor,
} = require('../src/viewer-monitor');

test('collects platform viewers and calculates the total', async () => {
  const updates = [];
  const monitor = createViewerMonitor({
    getConfig: () => ({
      connectors: {
        twitch: { enabled: true, channel: 'monstercat', accessToken: 'token' },
        kick: { enabled: true, channel: 'xqc' },
        x: { enabled: true, liveUrl: 'https://x.com/live' },
      },
    }),
    fetchTwitch: async () => 100,
    fetchKick: async () => 250,
    onUpdate: (snapshot) => updates.push(snapshot),
  });

  await monitor.refresh();
  monitor.updateExternalCount('x', 50);

  assert.equal(monitor.getSnapshot().total, 400);
  assert.deepEqual(
    monitor.getSnapshot().platforms.map(({ platform, state, count }) => ({
      platform,
      state,
      count,
    })),
    [
      { platform: 'twitch', state: 'available', count: 100 },
      { platform: 'kick', state: 'available', count: 250 },
      { platform: 'x', state: 'available', count: 50 },
    ],
  );
  assert.ok(updates.length >= 3);
});

test('keeps viewer lookup failures isolated', async () => {
  const monitor = createViewerMonitor({
    getConfig: () => ({
      connectors: {
        twitch: { enabled: true, channel: 'monstercat' },
        kick: { enabled: false },
        x: { enabled: false },
      },
    }),
    fetchTwitch: async () => {
      throw new Error('token unavailable');
    },
  });

  await monitor.refresh();

  const [twitch, kick, x] = monitor.getSnapshot().platforms;

  assert.equal(twitch.state, 'unavailable');
  assert.match(twitch.error, /token unavailable/);
  assert.equal(kick.state, 'disabled');
  assert.equal(x.state, 'disabled');
  assert.equal(monitor.getSnapshot().total, 0);
});

test('times out viewer lookups without blocking the monitor', async () => {
  const monitor = createViewerMonitor({
    getConfig: () => ({
      connectors: {
        twitch: { enabled: true, channel: 'monstercat' },
        kick: { enabled: false },
        x: { enabled: false },
      },
    }),
    fetchTwitch: async () => new Promise(() => {}),
    timeoutMs: 5,
  });

  await monitor.refresh();

  assert.match(monitor.getSnapshot().platforms[0].error, /timed out/);
});

test('adapts polling from Twitch rate-limit headers without going below base interval', () => {
  const originalNow = Date.now;

  Date.now = () => 1_000_000;

  try {
    assert.equal(
      calculateAdaptivePollMs({ remaining: 100, resetAt: 1060 }, 10_000),
      10_000,
    );
    assert.equal(
      calculateAdaptivePollMs({ remaining: 12, resetAt: 1060 }, 10_000),
      30_000,
    );
    assert.equal(
      calculateAdaptivePollMs({ remaining: 10, resetAt: 1060 }, 10_000),
      61_000,
    );
  } finally {
    Date.now = originalNow;
  }
});

test('returns to the base polling interval without current Twitch rate-limit headers', () => {
  assert.equal(calculateAdaptivePollMs(undefined, 10_000), 10_000);
  assert.equal(calculateAdaptivePollMs({}, 10_000), 10_000);
});

test('keeps polling on a fixed start-to-start cadence', () => {
  assert.equal(calculateFixedCadenceDelay(1_000, 10_000, 1_600), 9_400);
  assert.equal(calculateFixedCadenceDelay(1_000, 10_000, 12_000), 0);
});

test('publishes Kick viewers without waiting for Twitch', async () => {
  let resolveTwitch;
  const updates = [];
  const monitor = createViewerMonitor({
    getConfig: () => ({
      connectors: {
        twitch: { enabled: true },
        kick: { enabled: true },
        x: { enabled: false },
      },
    }),
    fetchTwitch: () => new Promise((resolve) => {
      resolveTwitch = resolve;
    }),
    fetchKick: async () => 250,
    onUpdate: (snapshot) => updates.push(snapshot),
  });
  const refreshPromise = monitor.refresh();

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(updates.at(-1).platforms.find(({ platform }) => platform === 'kick').count, 250);
  assert.equal(updates.at(-1).platforms.find(({ platform }) => platform === 'twitch').count, undefined);

  resolveTwitch(100);
  await refreshPromise;
});
