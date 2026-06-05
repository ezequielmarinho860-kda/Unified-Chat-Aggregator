const { resolveEnabledConnectors } = require('./connector-config');

const PLATFORM_ORDER = ['twitch', 'kick', 'x'];
const DEFAULT_TWITCH_CLIENT_ID = 'juln34d24v0zdm6l2dtv8omk6g0cqd';
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
  connectors: {
    twitch: {
      enabled: true,
      channel: 'monstercat',
      clientId: DEFAULT_TWITCH_CLIENT_ID,
      accessToken: '',
      userId: '',
      login: '',
      displayName: '',
    },
    kick: {
      enabled: true,
      channel: 'xqc',
      chatroomId: '',
    },
    x: {
      enabled: false,
      liveUrl: '',
      showBrowser: false,
    },
  },
});

const normalizeAppConfig = (config = {}) => {
  const connectors = config.connectors ?? {};

  return {
    connectors: {
      twitch: {
        enabled: normalizeBoolean(connectors.twitch?.enabled, true),
        channel: normalizeString(connectors.twitch?.channel, 'monstercat'),
        clientId: normalizeString(connectors.twitch?.clientId, ''),
        accessToken: normalizeString(connectors.twitch?.accessToken, ''),
        userId: normalizeString(connectors.twitch?.userId, ''),
        login: normalizeString(connectors.twitch?.login, ''),
        displayName: normalizeString(connectors.twitch?.displayName, ''),
      },
      kick: {
        enabled: normalizeBoolean(connectors.kick?.enabled, true),
        channel: normalizeString(connectors.kick?.channel, 'xqc'),
        chatroomId: normalizeString(connectors.kick?.chatroomId, ''),
      },
      x: {
        enabled: normalizeBoolean(connectors.x?.enabled, false),
        liveUrl: normalizeString(connectors.x?.liveUrl, ''),
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

const clearEnvironmentOverrides = (env = process.env) => {
  for (const key of ENV_OVERRIDE_KEYS) {
    delete env[key];
  }
};

const createPublicAppConfig = (config = {}) => {
  const normalizedConfig = normalizeAppConfig(config);
  const { twitch, kick, x } = normalizedConfig.connectors;

  return {
    connectors: {
      twitch: {
        enabled: twitch.enabled,
        channel: twitch.channel,
        auth: {
          connected: Boolean(twitch.accessToken),
          userId: twitch.userId,
          login: twitch.login,
          displayName: twitch.displayName,
        },
      },
      kick,
      x,
    },
  };
};

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

module.exports = {
  DEFAULT_APP_CONFIG,
  ENV_OVERRIDE_KEYS,
  PLATFORM_ORDER,
  applyEnvironmentOverrides,
  clearEnvironmentOverrides,
  createPublicAppConfig,
  normalizeAppConfig,
};
