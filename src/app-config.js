const { resolveEnabledConnectors } = require('./connector-config');

const PLATFORM_ORDER = ['twitch', 'kick', 'x'];
const DEFAULT_TWITCH_CLIENT_ID = 'juln34d24v0zdm6l2dtv8omk6g0cqd';
const DEFAULT_KICK_CLIENT_ID = '01KTB84VBDCSE2QBMA531PZ5J1';
const DEFAULT_KICK_OAUTH_BROKER_URL =
  'https://kick-oauth-broker.ezequielmarinho860.workers.dev';
const ENV_OVERRIDE_KEYS = [
  'CONNECTORS',
  'TWITCH_CHANNEL',
  'TWITCH_ACCESS_TOKEN',
  'KICK_CHANNEL',
  'KICK_CHATROOM_ID',
  'X_LIVE_URL',
  'X_SHOW_BROWSER',
];

const DEFAULT_APP_CONFIG = Object.freeze({
  ui: {
    theme: 'light',
  },
  connectors: {
    twitch: {
      enabled: true,
      channel: 'monstercat',
      sources: [
        { enabled: true, channel: 'monstercat' },
        { enabled: false, channel: '' },
      ],
      clientId: DEFAULT_TWITCH_CLIENT_ID,
      accessToken: '',
      userId: '',
      login: '',
      displayName: '',
    },
    kick: {
      enabled: true,
      channel: 'xqc',
      sources: [
        { enabled: true, channel: 'xqc' },
        { enabled: false, channel: '' },
      ],
      chatroomId: '',
      clientId: DEFAULT_KICK_CLIENT_ID,
      clientSecret: '',
      oauthBrokerUrl: DEFAULT_KICK_OAUTH_BROKER_URL,
      accessToken: '',
      refreshToken: '',
      expiresAt: '',
      userId: '',
      login: '',
      displayName: '',
    },
    x: {
      enabled: false,
      liveUrl: '',
      sources: [
        { enabled: false, liveUrl: '' },
        { enabled: false, liveUrl: '' },
      ],
      showBrowser: false,
    },
  },
});

const normalizeAppConfig = (config = {}) => {
  const connectors = config.connectors ?? {};
  const twitchSources = normalizeChannelSources(connectors.twitch, [
    { enabled: true, channel: 'monstercat' },
    { enabled: false, channel: '' },
  ]);
  const kickSources = normalizeChannelSources(connectors.kick, [
    { enabled: true, channel: 'xqc' },
    { enabled: false, channel: '' },
  ]);
  const xSources = normalizeLiveUrlSources(connectors.x);

  return {
    ui: {
      theme: normalizeTheme(config.ui?.theme),
    },
    connectors: {
      twitch: {
        enabled: normalizeBoolean(connectors.twitch?.enabled, true),
        channel: twitchSources[0].channel,
        sources: twitchSources,
        clientId: normalizeString(connectors.twitch?.clientId, ''),
        accessToken: normalizeString(connectors.twitch?.accessToken, ''),
        userId: normalizeString(connectors.twitch?.userId, ''),
        login: normalizeString(connectors.twitch?.login, ''),
        displayName: normalizeString(connectors.twitch?.displayName, ''),
      },
      kick: {
        enabled: normalizeBoolean(connectors.kick?.enabled, true),
        channel: kickSources[0].channel,
        sources: kickSources,
        chatroomId: normalizeString(connectors.kick?.chatroomId, ''),
        clientId: normalizeString(connectors.kick?.clientId, DEFAULT_KICK_CLIENT_ID),
        clientSecret: normalizeString(connectors.kick?.clientSecret, ''),
        oauthBrokerUrl: normalizeString(
          connectors.kick?.oauthBrokerUrl,
          DEFAULT_KICK_OAUTH_BROKER_URL,
        ),
        accessToken: normalizeString(connectors.kick?.accessToken, ''),
        refreshToken: normalizeString(connectors.kick?.refreshToken, ''),
        expiresAt: normalizeString(connectors.kick?.expiresAt, ''),
        userId: normalizeString(connectors.kick?.userId, ''),
        login: normalizeString(connectors.kick?.login, ''),
        displayName: normalizeString(connectors.kick?.displayName, ''),
      },
      x: {
        enabled: normalizeBoolean(connectors.x?.enabled, false),
        liveUrl: xSources[0].liveUrl,
        sources: xSources,
        showBrowser: normalizeBoolean(connectors.x?.showBrowser, false),
      },
    },
  };
};

const applyEnvironmentOverrides = (config, env = process.env) => {
  const runtimeConfig = normalizeAppConfig(config);
  const overrides = [];
  const hasConnectorOverride =
    typeof env.CONNECTORS === 'string' && env.CONNECTORS.trim().length > 0;

  if (hasConnectorOverride) {
    const enabledConnectors = resolveEnabledConnectors(env.CONNECTORS);

    for (const platform of PLATFORM_ORDER) {
      runtimeConfig.connectors[platform].enabled = enabledConnectors.includes(platform);
    }

    overrides.push('CONNECTORS');
  } else if (env.X_LIVE_URL) {
    runtimeConfig.connectors.x.enabled = true;
    overrides.push('X_LIVE_URL');
  }

  if (env.TWITCH_CHANNEL) {
    runtimeConfig.connectors.twitch.channel = env.TWITCH_CHANNEL;
    runtimeConfig.connectors.twitch.sources[0] = {
      enabled: true,
      channel: normalizeString(env.TWITCH_CHANNEL, ''),
    };
    runtimeConfig.connectors.twitch.enabled =
      runtimeConfig.connectors.twitch.enabled || !hasConnectorOverride;
    overrides.push('TWITCH_CHANNEL');
  }

  if (env.TWITCH_ACCESS_TOKEN) {
    runtimeConfig.connectors.twitch.accessToken = env.TWITCH_ACCESS_TOKEN;
    runtimeConfig.connectors.twitch.enabled =
      runtimeConfig.connectors.twitch.enabled || !hasConnectorOverride;
    overrides.push('TWITCH_ACCESS_TOKEN');
  }

  if (env.TWITCH_CLIENT_ID) {
    runtimeConfig.connectors.twitch.clientId = env.TWITCH_CLIENT_ID;
    overrides.push('TWITCH_CLIENT_ID');
  }

  if (env.KICK_CHANNEL) {
    runtimeConfig.connectors.kick.channel = env.KICK_CHANNEL;
    runtimeConfig.connectors.kick.sources[0] = {
      enabled: true,
      channel: normalizeString(env.KICK_CHANNEL, ''),
    };
    runtimeConfig.connectors.kick.enabled =
      runtimeConfig.connectors.kick.enabled || !hasConnectorOverride;
    overrides.push('KICK_CHANNEL');
  }

  if (env.KICK_CHATROOM_ID) {
    runtimeConfig.connectors.kick.chatroomId = env.KICK_CHATROOM_ID;
    runtimeConfig.connectors.kick.enabled =
      runtimeConfig.connectors.kick.enabled || !hasConnectorOverride;
    overrides.push('KICK_CHATROOM_ID');
  }

  if (env.X_LIVE_URL) {
    runtimeConfig.connectors.x.liveUrl = env.X_LIVE_URL;
    runtimeConfig.connectors.x.sources[0] = {
      enabled: true,
      liveUrl: normalizeString(env.X_LIVE_URL, ''),
    };
    runtimeConfig.connectors.x.enabled =
      runtimeConfig.connectors.x.enabled || !hasConnectorOverride;
    overrides.push('X_LIVE_URL');
  }

  if (env.X_SHOW_BROWSER) {
    runtimeConfig.connectors.x.showBrowser = env.X_SHOW_BROWSER === 'true';
    overrides.push('X_SHOW_BROWSER');
  }

  return {
    runtimeConfig,
    overrides: [...new Set(overrides)],
  };
};

const createRuntimeAppConfig = (
  config,
  { allowEnvironmentOverrides = true, env = process.env } = {},
) => {
  if (!allowEnvironmentOverrides) {
    return {
      runtimeConfig: normalizeAppConfig(config),
      overrides: [],
    };
  }

  return applyEnvironmentOverrides(config, env);
};

const clearEnvironmentOverrides = (env = process.env) => {
  for (const key of ENV_OVERRIDE_KEYS) {
    delete env[key];
  }
};

const createPublicAppConfig = (config = {}) => {
  const normalizedConfig = normalizeAppConfig(config);
  const { twitch, kick, x } = normalizedConfig.connectors;

  return {
    ui: normalizedConfig.ui,
    connectors: {
      twitch: {
        enabled: twitch.enabled,
        channel: twitch.channel,
        sources: twitch.sources,
        auth: {
          connected: Boolean(twitch.accessToken),
          userId: twitch.userId,
          login: twitch.login,
          displayName: twitch.displayName,
        },
      },
      kick: {
        enabled: kick.enabled,
        channel: kick.channel,
        sources: kick.sources,
        chatroomId: kick.chatroomId,
        auth: {
          connected: Boolean(kick.accessToken),
          userId: kick.userId,
          login: kick.login,
          displayName: kick.displayName,
          expiresAt: kick.expiresAt,
        },
      },
      x,
    },
  };
};

const normalizeChannelSources = (connectorConfig = {}, defaults) =>
  normalizeFixedSources({
    fieldName: 'channel',
    connectorConfig,
    defaults,
  });

const normalizeLiveUrlSources = (connectorConfig = {}) =>
  normalizeFixedSources({
    fieldName: 'liveUrl',
    connectorConfig,
    defaults: [
      { enabled: false, liveUrl: '' },
      { enabled: false, liveUrl: '' },
    ],
  });

const normalizeFixedSources = ({ fieldName, connectorConfig = {}, defaults }) => {
  const rawSources = Array.isArray(connectorConfig.sources)
    ? connectorConfig.sources
    : createLegacySources({ fieldName, connectorConfig });

  return defaults.map((defaultSource, index) => {
    const rawSource = rawSources[index] ?? {};
    const value = normalizeString(rawSource[fieldName], defaultSource[fieldName]);
    const enabledFallback =
      index === 0 ? defaultSource.enabled : value.length > 0 || defaultSource.enabled;

    return {
      enabled: normalizeBoolean(rawSource.enabled, enabledFallback),
      [fieldName]: value,
    };
  });
};

const createLegacySources = ({ fieldName, connectorConfig = {} }) => [
  {
    enabled: fieldName === 'liveUrl' ? Boolean(connectorConfig[fieldName]) : true,
    [fieldName]: connectorConfig[fieldName],
  },
  {
    enabled: Boolean(connectorConfig[`${fieldName}2`]),
    [fieldName]: connectorConfig[`${fieldName}2`],
  },
];

const normalizeBoolean = (value, fallback) => {
  if (typeof value === 'boolean') {
    return value;
  }

  return fallback;
};

const normalizeString = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.trim();
};

const normalizeTheme = (value) => (value === 'dark' ? 'dark' : 'light');

module.exports = {
  DEFAULT_APP_CONFIG,
  DEFAULT_KICK_CLIENT_ID,
  DEFAULT_KICK_OAUTH_BROKER_URL,
  ENV_OVERRIDE_KEYS,
  PLATFORM_ORDER,
  applyEnvironmentOverrides,
  clearEnvironmentOverrides,
  createPublicAppConfig,
  createRuntimeAppConfig,
  normalizeAppConfig,
};
