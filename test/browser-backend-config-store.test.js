const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createBrowserBackendConfigStore,
  normalizeBrowserBackendConfig,
} = require('../src/browser-backend/config-store');

const createTempConfigPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'uca-browser-config-')), 'browser-config.json');

test('normalizes browser backend config by allowlist', () => {
  const config = normalizeBrowserBackendConfig({
    secret: 'do-not-keep',
    sources: {
      kick: [
        { channel: ' https://kick.com/xqc ', enabled: true, token: 'secret' },
        { channel: '', enabled: 'yes' },
        { channel: 'ignored', enabled: true },
      ],
      twitch: [{ channel: ' Monstercat ', enabled: true }],
      x: [{ enabled: true, liveUrl: ' @chooserich ' }],
    },
    viewer: {
      showExternalChats: false,
      theme: 'LIGHT',
      title: ' Browser Demo ',
    },
  });

  assert.deepEqual(config, {
    sources: {
      kick: [
        { channel: 'https://kick.com/xqc', enabled: true },
        { channel: '', enabled: false },
      ],
      twitch: [
        { channel: 'Monstercat', enabled: true },
        { channel: '', enabled: false },
      ],
      x: [
        { enabled: true, liveUrl: '@chooserich' },
        { enabled: false, liveUrl: '' },
      ],
    },
    viewer: {
      showExternalChats: false,
      theme: 'light',
      title: 'Browser Demo',
    },
  });
  assert.doesNotMatch(JSON.stringify(config), /secret|token|ignored/);
  assert.equal(normalizeBrowserBackendConfig(null).viewer.title, 'Unified Chat Aggregator');
});

test('saves and reloads browser backend config from disk', () => {
  const configPath = createTempConfigPath();
  const store = createBrowserBackendConfigStore(configPath);

  assert.equal(store.exists(), false);
  assert.equal(store.load().viewer.title, 'Unified Chat Aggregator');

  const saved = store.save({
    sources: {
      twitch: [{ channel: 'ESL_SC2', enabled: true }],
    },
    viewer: {
      title: 'Saved Demo',
    },
  });
  const reloaded = createBrowserBackendConfigStore(configPath).load();

  assert.equal(store.exists(), true);
  assert.deepEqual(reloaded, saved);
  assert.equal(reloaded.viewer.title, 'Saved Demo');
  assert.equal(reloaded.sources.twitch[0].channel, 'ESL_SC2');
});
