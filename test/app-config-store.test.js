const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAppConfigStore } = require('../src/app-config-store');

test('loads defaults when config file is missing', () => {
  const configPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'uca-config-')),
    'config.json',
  );
  const store = createAppConfigStore(configPath);

  assert.equal(store.exists(), false);
  assert.equal(store.load().connectors.twitch.channel, 'monstercat');
});

test('saves and reloads normalized config', () => {
  const configPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'uca-config-')),
    'config.json',
  );
  const store = createAppConfigStore(configPath);

  assert.equal(store.exists(), false);
  store.save({
    connectors: {
      twitch: { enabled: true, channel: '  xqc  ' },
    },
  });

  assert.equal(store.exists(), true);
  assert.equal(store.load().connectors.twitch.channel, 'xqc');
  assert.equal(store.load().connectors.kick.channel, 'xqc');
});
