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
  if (source.platform !== 'twitch') {
    return source;
  }

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

const normalizeTwitchPlayerChannel = (channel) => {
  if (typeof channel !== 'string' || channel.trim().length === 0) {
    return undefined;
  }

  return channel.trim().replace(/^#/, '').toLowerCase();
};

module.exports = {
  createPublicViewerSources,
  normalizeTwitchPlayerChannel,
};
