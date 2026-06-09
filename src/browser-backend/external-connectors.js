const { WebSocket } = require('ws');
const { createChatHub } = require('../chat-hub');
const { createKickConnector } = require('../connectors/kick-connector');
const { createTwitchConnector } = require('../connectors/twitch-connector');
const {
  serializePublicChatMessage,
  serializePublicStatus,
} = require('../public-realtime');
const { createRuntimeConfigFromBrowserBackendConfig } = require('./config-store');

const createBrowserBackendExternalConnectors = ({
  createHub = createChatHub,
  createKick = createKickConnector,
  createTwitch = createTwitchConnector,
  fetchImpl = fetch,
  onEvent = () => {},
  webSocketFactory = (url) => new WebSocket(url),
} = {}) => {
  let hub;
  let unsubscribe = [];

  const applyConfig = async (browserConfig = {}) => {
    await stop();

    const connectors = createBackendConnectorsFromBrowserConfig(browserConfig, {
      createKick,
      createTwitch,
      fetchImpl,
      webSocketFactory,
    });

    hub = createHub({ connectors });
    unsubscribe = [
      hub.onMessage((message) => {
        emitPublicEvent('chat.message', serializePublicChatMessage(message));
      }),
      hub.onStatus((status) => {
        emitPublicEvent('source.status', serializePublicStatus(status));
      }),
    ];

    await hub.start();
    return connectors;
  };

  const stop = async () => {
    const activeHub = hub;

    hub = undefined;

    while (unsubscribe.length > 0) {
      unsubscribe.pop()();
    }

    await activeHub?.stop();
  };

  const emitPublicEvent = (type, data) => {
    onEvent({ data, type });
  };

  return {
    applyConfig,
    stop,
  };
};

const createBackendConnectorsFromBrowserConfig = (
  browserConfig = {},
  {
    createKick = createKickConnector,
    createTwitch = createTwitchConnector,
    fetchImpl = fetch,
    webSocketFactory = (url) => new WebSocket(url),
  } = {},
) => {
  const runtimeConfig = createRuntimeConfigFromBrowserBackendConfig(browserConfig);

  return [
    ...createTwitchConnectors(runtimeConfig.connectors.twitch, {
      createTwitch,
      fetchImpl,
      webSocketFactory,
    }),
    ...createKickConnectors(runtimeConfig.connectors.kick, {
      createKick,
      fetchImpl,
      webSocketFactory,
    }),
  ];
};

const createTwitchConnectors = (
  config = {},
  { createTwitch = createTwitchConnector, fetchImpl = fetch, webSocketFactory },
) =>
  getEnabledSources(config, 'channel').map((source) =>
    createTwitch({
      channel: source.channel,
      fetchImpl,
      webSocketFactory,
    }));

const createKickConnectors = (
  config = {},
  { createKick = createKickConnector, fetchImpl = fetch, webSocketFactory },
) =>
  getEnabledSources(config, 'channel').map((source) =>
    createKick({
      channel: source.channel,
      fetchImpl,
      webSocketFactory,
    }));

const getEnabledSources = (config = {}, fieldName) =>
  (Array.isArray(config.sources) ? config.sources : [])
    .filter((source) => source.enabled && source[fieldName]);

module.exports = {
  createBackendConnectorsFromBrowserConfig,
  createBrowserBackendExternalConnectors,
};
