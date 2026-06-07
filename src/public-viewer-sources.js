const { PLATFORM_ORDER } = require('./app-config');
const { createConnectorSource } = require('./source-identity');

const createPublicViewerSources = (config = {}) =>
  Object.fromEntries(
    PLATFORM_ORDER.flatMap((platform) => {
      const connectorConfig = config.connectors?.[platform];

      if (!connectorConfig?.enabled) {
        return [];
      }

      const source = createConnectorSource({ platform, ...connectorConfig });
      return source ? [[platform, addPublicViewerFields(source, connectorConfig)]] : [];
    }),
  );

const addPublicViewerFields = (source, connectorConfig) => {
  if (source.platform === 'twitch') {
    return addTwitchViewerFields(source, connectorConfig);
  }

  if (source.platform === 'kick') {
    return addKickViewerFields(source, connectorConfig);
  }

  if (source.platform === 'x') {
    return addXViewerFields(source, connectorConfig);
  }

  return source;
};

const addTwitchViewerFields = (source, connectorConfig) => {
  const channel = normalizeTwitchPlayerChannel(connectorConfig.channel ?? source.channelLabel);

  if (!channel) {
    return source;
  }

  return {
    ...source,
    channelLabel: channel,
    watchUrl: `https://www.twitch.tv/${channel}`,
    player: {
      provider: 'twitch',
      channel,
    },
  };
};

const addKickViewerFields = (source, connectorConfig) => {
  const channel = normalizeKickChannel(connectorConfig.channel ?? source.channelLabel);

  return channel
    ? {
        ...source,
        channelLabel: channel,
        watchUrl: `https://kick.com/${channel}`,
      }
    : source;
};

const addXViewerFields = (source, connectorConfig) => {
  const watchUrl = normalizeXWatchUrl(connectorConfig.liveUrl ?? source.channelLabel);

  return watchUrl ? { ...source, watchUrl } : source;
};

const normalizeTwitchPlayerChannel = (channel) => {
  if (typeof channel !== 'string' || channel.trim().length === 0) {
    return undefined;
  }

  return channel.trim().replace(/^#/, '').toLowerCase();
};

const normalizeKickChannel = (channel) => {
  if (typeof channel !== 'string' || channel.trim().length === 0) {
    return undefined;
  }

  return channel.trim().replace(/^https?:\/\/(?:www\.)?kick\.com\//i, '').replace(/^[@#]+/, '');
};

const normalizeXWatchUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim();

  try {
    const parsedUrl = new URL(normalized);

    return ['x.com', 'twitter.com'].includes(parsedUrl.hostname.replace(/^www\./, ''))
      ? parsedUrl.toString()
      : undefined;
  } catch {
    const handle = normalized.replace(/^[@#]+/, '');

    return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}/live` : undefined;
  }
};

module.exports = {
  createPublicViewerSources,
  normalizeKickChannel,
  normalizeTwitchPlayerChannel,
  normalizeXWatchUrl,
};
