const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyEnvironmentOverrides,
  clearEnvironmentOverrides,
  createPublicAppConfig,
  createRuntimeAppConfig,
  normalizeAppConfig,
} = require('../src/app-config');

test('normalizes missing app config with defaults', () => {
  const config = normalizeAppConfig();

  assert.equal(config.connectors.twitch.channel, 'monstercat');
  assert.equal(config.connectors.twitch.clientId, '');
  assert.equal(config.connectors.twitch.accessToken, '');
  assert.equal(config.connectors.kick.channel, 'xqc');
  assert.equal(config.connectors.x.enabled, false);
});

test('normalizes user connector settings', () => {
  const config = normalizeAppConfig({
    connectors: {
      twitch: {
        enabled: true,
        channel: '  openai  ',
        clientId: '  client-1  ',
        accessToken: '  token  ',
        userId: '  user-1  ',
        login: '  sender  ',
        displayName: '  Sender  ',
      },
      kick: { enabled: true, channel: '  streamer  ', chatroomId: '  123  ' },
      x: { enabled: true, liveUrl: '  https://x.com/live  ', showBrowser: true },
    },
  });

  assert.equal(config.connectors.twitch.channel, 'openai');
  assert.equal(config.connectors.twitch.clientId, 'client-1');
  assert.equal(config.connectors.twitch.accessToken, 'token');
  assert.equal(config.connectors.twitch.userId, 'user-1');
  assert.equal(config.connectors.twitch.login, 'sender');
  assert.equal(config.connectors.twitch.displayName, 'Sender');
  assert.equal(config.connectors.kick.chatroomId, '123');
  assert.equal(config.connectors.x.liveUrl, 'https://x.com/live');
  assert.equal(config.connectors.x.showBrowser, true);
});

test('applies environment connector overrides', () => {
  const { runtimeConfig, overrides } = applyEnvironmentOverrides(normalizeAppConfig(), {
    CONNECTORS: 'x,twitch',
    TWITCH_CHANNEL: 'xqc',
    TWITCH_CLIENT_ID: 'client-1',
    TWITCH_ACCESS_TOKEN: 'token',
    X_LIVE_URL: 'https://x.com/live',
    X_SHOW_BROWSER: 'true',
  });

  assert.equal(runtimeConfig.connectors.kick.enabled, false);
  assert.equal(runtimeConfig.connectors.twitch.enabled, true);
  assert.equal(runtimeConfig.connectors.twitch.channel, 'xqc');
  assert.equal(runtimeConfig.connectors.twitch.clientId, 'client-1');
  assert.equal(runtimeConfig.connectors.twitch.accessToken, 'token');
  assert.equal(runtimeConfig.connectors.x.enabled, true);
  assert.equal(runtimeConfig.connectors.x.liveUrl, 'https://x.com/live');
  assert.equal(runtimeConfig.connectors.x.showBrowser, true);
  assert.deepEqual(overrides, [
    'CONNECTORS',
    'TWITCH_CHANNEL',
    'TWITCH_ACCESS_TOKEN',
    'TWITCH_CLIENT_ID',
    'X_LIVE_URL',
    'X_SHOW_BROWSER',
  ]);
});

test('keeps CONNECTORS as the source of enabled platforms', () => {
  const { runtimeConfig } = applyEnvironmentOverrides(normalizeAppConfig(), {
    CONNECTORS: 'x',
    KICK_CHANNEL: 'xqc',
    TWITCH_CHANNEL: 'monstercat',
    X_LIVE_URL: 'https://x.com/live',
  });

  assert.equal(runtimeConfig.connectors.kick.enabled, false);
  assert.equal(runtimeConfig.connectors.twitch.enabled, false);
  assert.equal(runtimeConfig.connectors.x.enabled, true);
});

test('can build runtime config without environment overrides', () => {
  const { runtimeConfig, overrides } = createRuntimeAppConfig(
    {
      connectors: {
        twitch: { enabled: true, channel: 'saved-twitch' },
        kick: { enabled: true, channel: 'saved-kick' },
        x: { enabled: true, liveUrl: 'https://x.com/i/broadcasts/saved' },
      },
    },
    {
      allowEnvironmentOverrides: false,
      env: {
        TWITCH_CHANNEL: 'env-twitch',
        KICK_CHANNEL: 'env-kick',
        X_LIVE_URL: 'https://x.com/i/broadcasts/env',
      },
    },
  );

  assert.equal(runtimeConfig.connectors.twitch.channel, 'saved-twitch');
  assert.equal(runtimeConfig.connectors.kick.channel, 'saved-kick');
  assert.equal(runtimeConfig.connectors.x.liveUrl, 'https://x.com/i/broadcasts/saved');
  assert.deepEqual(overrides, []);
});

test('clears environment overrides from the provided env object', () => {
  const env = {
    CONNECTORS: 'x',
    KICK_CHANNEL: 'luanz7',
    KICK_CHATROOM_ID: '123',
    TWITCH_CHANNEL: 'monstercat',
    TWITCH_ACCESS_TOKEN: 'token',
    TWITCH_CLIENT_ID: 'client-1',
    X_LIVE_URL: 'https://x.com/live',
    X_SHOW_BROWSER: 'true',
    OTHER_ENV: 'kept',
  };

  clearEnvironmentOverrides(env);

  assert.deepEqual(env, { OTHER_ENV: 'kept', TWITCH_CLIENT_ID: 'client-1' });
});

test('creates a public app config without exposing access tokens', () => {
  const publicConfig = createPublicAppConfig({
    connectors: {
      twitch: {
        enabled: true,
        channel: 'monstercat',
        clientId: 'client-1',
        accessToken: 'secret-token',
        userId: 'user-1',
        login: 'sender',
        displayName: 'Sender',
      },
    },
  });

  assert.equal(publicConfig.connectors.twitch.accessToken, undefined);
  assert.equal(publicConfig.connectors.twitch.clientId, undefined);
  assert.deepEqual(publicConfig.connectors.twitch.auth, {
    connected: true,
    userId: 'user-1',
    login: 'sender',
    displayName: 'Sender',
  });
});
