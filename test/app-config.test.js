const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_BROWSER_BACKEND_URL,
  DEFAULT_KICK_CLIENT_ID,
  DEFAULT_KICK_OAUTH_BROKER_URL,
  applyEnvironmentOverrides,
  clearEnvironmentOverrides,
  createPublicAppConfig,
  createRuntimeAppConfig,
  normalizeAppConfig,
} = require('../src/app-config');

test('normalizes missing app config with defaults', () => {
  const config = normalizeAppConfig();

  assert.equal(config.connectors.twitch.channel, 'monstercat');
  assert.deepEqual(config.connectors.twitch.sources, [
    { enabled: true, channel: 'monstercat' },
    { enabled: false, channel: '' },
  ]);
  assert.equal(config.connectors.twitch.clientId, '');
  assert.equal(config.connectors.twitch.accessToken, '');
  assert.equal(config.connectors.kick.channel, 'xqc');
  assert.equal(config.connectors.kick.clientId, DEFAULT_KICK_CLIENT_ID);
  assert.equal(config.connectors.kick.accessToken, '');
  assert.equal(config.connectors.kick.oauthBrokerUrl, DEFAULT_KICK_OAUTH_BROKER_URL);
  assert.equal(config.connectors.x.enabled, false);
  assert.deepEqual(config.connectors.x.sources, [
    { enabled: false, liveUrl: '' },
    { enabled: false, liveUrl: '' },
  ]);
  assert.deepEqual(config.browserBackend, {
    mode: 'embedded',
    url: DEFAULT_BROWSER_BACKEND_URL,
    ingestToken: '',
  });
  assert.equal(config.ui.theme, 'light');
});

test('normalizes user connector settings', () => {
  const config = normalizeAppConfig({
    ui: { theme: 'dark' },
    browserBackend: {
      mode: 'external',
      url: '  http://127.0.0.1:47899/  ',
      ingestToken: '  ingest-token  ',
    },
    connectors: {
      twitch: {
        enabled: true,
        sources: [
          { enabled: true, channel: '  openai  ' },
          { enabled: true, channel: '  backup  ' },
        ],
        clientId: '  client-1  ',
        accessToken: '  token  ',
        userId: '  user-1  ',
        login: '  sender  ',
        displayName: '  Sender  ',
      },
      kick: {
        enabled: true,
        channel: '  streamer  ',
        chatroomId: '  123  ',
        clientId: '  kick-client  ',
        clientSecret: '  kick-secret  ',
        oauthBrokerUrl: '  https://broker.example.com  ',
        accessToken: '  kick-token  ',
        refreshToken: '  kick-refresh  ',
        expiresAt: '  2026-06-04T20:00:00.000Z  ',
        userId: '  kick-user  ',
        login: '  kick-login  ',
        displayName: '  Kick Sender  ',
      },
      x: {
        enabled: true,
        sources: [
          { enabled: true, liveUrl: '  https://x.com/live  ' },
          { enabled: true, liveUrl: '  @second  ' },
        ],
        showBrowser: true,
      },
    },
  });

  assert.equal(config.connectors.twitch.channel, 'openai');
  assert.equal(config.connectors.twitch.sources[1].channel, 'backup');
  assert.equal(config.connectors.twitch.clientId, 'client-1');
  assert.equal(config.connectors.twitch.accessToken, 'token');
  assert.equal(config.connectors.twitch.userId, 'user-1');
  assert.equal(config.connectors.twitch.login, 'sender');
  assert.equal(config.connectors.twitch.displayName, 'Sender');
  assert.equal(config.connectors.kick.chatroomId, '123');
  assert.equal(config.connectors.kick.clientId, 'kick-client');
  assert.equal(config.connectors.kick.clientSecret, 'kick-secret');
  assert.equal(config.connectors.kick.oauthBrokerUrl, 'https://broker.example.com');
  assert.equal(config.connectors.kick.accessToken, 'kick-token');
  assert.equal(config.connectors.kick.refreshToken, 'kick-refresh');
  assert.equal(config.connectors.kick.expiresAt, '2026-06-04T20:00:00.000Z');
  assert.equal(config.connectors.kick.userId, 'kick-user');
  assert.equal(config.connectors.kick.login, 'kick-login');
  assert.equal(config.connectors.kick.displayName, 'Kick Sender');
  assert.equal(config.connectors.x.liveUrl, 'https://x.com/live');
  assert.equal(config.connectors.x.sources[1].liveUrl, '@second');
  assert.equal(config.connectors.x.showBrowser, true);
  assert.deepEqual(config.browserBackend, {
    mode: 'external',
    url: 'http://127.0.0.1:47899',
    ingestToken: 'ingest-token',
  });
  assert.equal(config.ui.theme, 'dark');
});

test('derives connector enabled state from filled source fields', () => {
  const config = normalizeAppConfig({
    connectors: {
      twitch: {
        enabled: false,
        sources: [
          { enabled: false, channel: '  streamer  ' },
          { enabled: false, channel: '' },
        ],
      },
      kick: {
        enabled: true,
        sources: [
          { enabled: true, channel: '' },
          { enabled: false, channel: '' },
        ],
      },
      x: {
        enabled: false,
        sources: [
          { enabled: false, liveUrl: '@chooserich' },
          { enabled: false, liveUrl: '' },
        ],
      },
    },
  });

  assert.equal(config.connectors.twitch.enabled, true);
  assert.deepEqual(config.connectors.twitch.sources, [
    { enabled: true, channel: 'streamer' },
    { enabled: false, channel: '' },
  ]);
  assert.equal(config.connectors.kick.enabled, false);
  assert.equal(config.connectors.x.enabled, true);
  assert.deepEqual(config.connectors.x.sources, [
    { enabled: true, liveUrl: '@chooserich' },
    { enabled: false, liveUrl: '' },
  ]);
});

test('falls back to light for unsupported themes', () => {
  assert.equal(normalizeAppConfig({ ui: { theme: 'sepia' } }).ui.theme, 'light');
});

test('applies environment connector overrides', () => {
  const { runtimeConfig, overrides } = applyEnvironmentOverrides(normalizeAppConfig(), {
    CONNECTORS: 'x,twitch',
    TWITCH_CHANNEL: 'xqc',
    TWITCH_CLIENT_ID: 'client-1',
    TWITCH_ACCESS_TOKEN: 'token',
    X_LIVE_URL: 'https://x.com/live',
    X_SHOW_BROWSER: 'true',
    BROWSER_BACKEND_URL: 'http://127.0.0.1:47899',
    APP_INGEST_TOKEN: 'app-token',
  });

  assert.equal(runtimeConfig.connectors.kick.enabled, false);
  assert.equal(runtimeConfig.connectors.twitch.enabled, true);
  assert.equal(runtimeConfig.connectors.twitch.channel, 'xqc');
  assert.equal(runtimeConfig.connectors.twitch.sources[0].channel, 'xqc');
  assert.equal(runtimeConfig.connectors.twitch.clientId, 'client-1');
  assert.equal(runtimeConfig.connectors.twitch.accessToken, 'token');
  assert.equal(runtimeConfig.connectors.x.enabled, true);
  assert.equal(runtimeConfig.connectors.x.liveUrl, 'https://x.com/live');
  assert.equal(runtimeConfig.connectors.x.sources[0].liveUrl, 'https://x.com/live');
  assert.equal(runtimeConfig.connectors.x.showBrowser, true);
  assert.deepEqual(runtimeConfig.browserBackend, {
    mode: 'external',
    url: 'http://127.0.0.1:47899',
    ingestToken: 'app-token',
  });
  assert.deepEqual(overrides, [
    'CONNECTORS',
    'TWITCH_CHANNEL',
    'TWITCH_ACCESS_TOKEN',
    'TWITCH_CLIENT_ID',
    'X_LIVE_URL',
    'X_SHOW_BROWSER',
    'BROWSER_BACKEND_URL',
    'APP_INGEST_TOKEN',
  ]);
});

test('keeps browser backend mode embedded when only the token is configured', () => {
  const { runtimeConfig, overrides } = applyEnvironmentOverrides(normalizeAppConfig(), {
    APP_INGEST_TOKEN: 'app-token',
  });

  assert.equal(runtimeConfig.browserBackend.mode, 'embedded');
  assert.equal(runtimeConfig.browserBackend.ingestToken, 'app-token');
  assert.deepEqual(overrides, ['APP_INGEST_TOKEN']);
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
  assert.equal(runtimeConfig.connectors.twitch.sources[0].channel, 'saved-twitch');
  assert.equal(runtimeConfig.connectors.kick.channel, 'saved-kick');
  assert.equal(runtimeConfig.connectors.x.liveUrl, 'https://x.com/i/broadcasts/saved');
  assert.deepEqual(overrides, []);
});

test('keeps browser backend environment overrides when connector overrides are disabled', () => {
  const { runtimeConfig, overrides } = createRuntimeAppConfig(
    {
      browserBackend: {
        mode: 'embedded',
        url: 'http://127.0.0.1:47831',
        ingestToken: '',
      },
      connectors: {
        twitch: { enabled: true, channel: 'saved-twitch' },
      },
    },
    {
      allowEnvironmentOverrides: false,
      env: {
        BROWSER_BACKEND_URL: 'http://127.0.0.1:47899',
        APP_INGEST_TOKEN: 'app-token',
        TWITCH_CHANNEL: 'env-twitch',
      },
    },
  );

  assert.equal(runtimeConfig.connectors.twitch.channel, 'saved-twitch');
  assert.deepEqual(runtimeConfig.browserBackend, {
    mode: 'external',
    url: 'http://127.0.0.1:47899',
    ingestToken: 'app-token',
  });
  assert.deepEqual(overrides, ['BROWSER_BACKEND_URL', 'APP_INGEST_TOKEN']);
});

test('supports explicit embedded browser backend mode from environment', () => {
  const { runtimeConfig } = createRuntimeAppConfig(normalizeAppConfig(), {
    env: {
      BROWSER_BACKEND_MODE: 'embedded',
      BROWSER_BACKEND_URL: 'http://127.0.0.1:47899',
      APP_INGEST_TOKEN: 'app-token',
    },
  });

  assert.deepEqual(runtimeConfig.browserBackend, {
    mode: 'embedded',
    url: 'http://127.0.0.1:47899',
    ingestToken: 'app-token',
  });
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
    BROWSER_BACKEND_MODE: 'external',
    BROWSER_BACKEND_URL: 'http://127.0.0.1:47899',
    APP_INGEST_TOKEN: 'app-token',
    OTHER_ENV: 'kept',
  };

  clearEnvironmentOverrides(env);

  assert.deepEqual(env, {
    APP_INGEST_TOKEN: 'app-token',
    BROWSER_BACKEND_MODE: 'external',
    BROWSER_BACKEND_URL: 'http://127.0.0.1:47899',
    OTHER_ENV: 'kept',
    TWITCH_CLIENT_ID: 'client-1',
  });
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
      kick: {
        enabled: true,
        channel: 'xqc',
        chatroomId: '123',
        clientId: 'kick-client',
        clientSecret: 'kick-secret',
        oauthBrokerUrl: 'https://broker.example.com',
        accessToken: 'kick-token',
        refreshToken: 'kick-refresh',
        expiresAt: '2026-06-04T20:00:00.000Z',
        userId: 'kick-user',
        login: 'kick-login',
        displayName: 'Kick Sender',
      },
    },
    browserBackend: {
      mode: 'external',
      url: 'http://127.0.0.1:47899',
      ingestToken: 'secret-ingest-token',
    },
  });

  assert.equal(publicConfig.connectors.twitch.accessToken, undefined);
  assert.deepEqual(publicConfig.connectors.twitch.sources, [
    { enabled: true, channel: 'monstercat' },
    { enabled: false, channel: '' },
  ]);
  assert.equal(publicConfig.connectors.twitch.clientId, undefined);
  assert.equal(publicConfig.connectors.kick.clientSecret, undefined);
  assert.equal(publicConfig.connectors.kick.accessToken, undefined);
  assert.equal(publicConfig.connectors.kick.refreshToken, undefined);
  assert.equal(publicConfig.connectors.kick.clientId, undefined);
  assert.equal(publicConfig.connectors.kick.oauthBrokerUrl, undefined);
  assert.deepEqual(publicConfig.browserBackend, {
    mode: 'external',
    url: 'http://127.0.0.1:47899',
  });
  assert.equal(publicConfig.browserBackend.ingestToken, undefined);
  assert.equal(publicConfig.ui.theme, 'light');
  assert.deepEqual(publicConfig.connectors.twitch.auth, {
    connected: true,
    userId: 'user-1',
    login: 'sender',
    displayName: 'Sender',
  });
  assert.deepEqual(publicConfig.connectors.kick.auth, {
    connected: true,
    userId: 'kick-user',
    login: 'kick-login',
    displayName: 'Kick Sender',
    expiresAt: '2026-06-04T20:00:00.000Z',
  });
});
