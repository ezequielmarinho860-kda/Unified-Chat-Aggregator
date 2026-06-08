const { EventEmitter } = require('node:events');
const { normalizeChatMessage } = require('./chat-message');
const { validateConnector } = require('./connectors/connector-contract');
const { createConnectorSource } = require('./source-identity');

const createChatHub = ({ connectors = [] } = {}) => {
  const events = new EventEmitter();
  const registeredConnectors = new Map();
  const connectorSubscriptions = new Map();
  const connectorStatuses = new Map();
  const connectorKeysByPlatform = new Map();

  const setConnectorStatus = (connectorKey, connector, patch) => {
    const source = resolveConnectorSource(connector);
    const previousStatus = connectorStatuses.get(connectorKey) ?? {
      key: connectorKey,
      platform: connector.platform,
      source,
      state: 'disabled',
      messageCount: 0,
      lastMessageAt: undefined,
      error: undefined,
      details: {},
    };
    const nextStatus = {
      ...previousStatus,
      ...patch,
      key: connectorKey,
      platform: connector.platform,
      source,
    };

    connectorStatuses.set(connectorKey, nextStatus);
    events.emit('status', nextStatus);
  };

  const publishMessage = (message, connectorKey, connectorSource) => {
    const normalizedMessage = normalizeChatMessage({
      ...message,
      source: message?.source ?? connectorSource,
    });
    const previousStatus = connectorStatuses.get(connectorKey);

    if (previousStatus) {
      setConnectorStatus(connectorKey, { platform: normalizedMessage.platform, source: connectorSource }, {
        state: 'connected',
        messageCount: previousStatus.messageCount + 1,
        lastMessageAt: normalizedMessage.timestamp,
        error: undefined,
      });
    }

    events.emit('message', normalizedMessage);
  };

  const registerConnector = (connector) => {
    validateConnector(connector);
    const connectorSource = resolveConnectorSource(connector);
    const connectorKey = getConnectorKey(connector, connectorSource);

    if (registeredConnectors.has(connectorKey)) {
      throw new Error(`Connector already registered: ${connectorKey}`);
    }

    registeredConnectors.set(connectorKey, connector);
    connectorSubscriptions.set(connectorKey, []);
    registerPlatformKey(connector.platform, connectorKey);
    setConnectorStatus(connectorKey, connector, {
      state: 'idle',
      details: getConnectorDetails(connector),
    });

    if (typeof connector.onMessage === 'function') {
      connectorSubscriptions
        .get(connectorKey)
        .push(connector.onMessage((message) => publishMessage(message, connectorKey, connectorSource)));
    }

    if (typeof connector.onError === 'function') {
      connectorSubscriptions.get(connectorKey).push(
        connector.onError((error) => {
          setConnectorStatus(connectorKey, connector, {
            state: 'error',
            error: error.message,
          });
        }),
      );
    }

    if (typeof connector.onStatus === 'function') {
      connectorSubscriptions.get(connectorKey).push(
        connector.onStatus((status) => {
          setConnectorStatus(connectorKey, connector, {
            state: status.state ?? 'connected',
            details: {
              ...getConnectorDetails(connector),
              ...status,
            },
          });
        }),
      );
    }
  };

  const unsubscribeConnector = (connectorKey) => {
    const subscriptions = connectorSubscriptions.get(connectorKey) ?? [];

    while (subscriptions.length > 0) {
      const unsubscribe = subscriptions.pop();
      unsubscribe();
    }

    connectorSubscriptions.delete(connectorKey);
  };

  const removeConnector = async (connectorKey) => {
    const connector = registeredConnectors.get(connectorKey);

    if (!connector) {
      return false;
    }

    await connector.disconnect();
    unsubscribeConnector(connectorKey);
    registeredConnectors.delete(connectorKey);
    connectorStatuses.delete(connectorKey);
    unregisterPlatformKey(connector.platform, connectorKey);
    events.emit('status', {
      key: connectorKey,
      platform: connector.platform,
      source: createConnectorSource(connector),
      state: 'disabled',
      messageCount: 0,
      lastMessageAt: undefined,
      error: undefined,
      details: {},
    });
    return true;
  };

  const startConnector = async (connector) => {
    const connectorKey = getConnectorKey(connector);

    setConnectorStatus(connectorKey, connector, { state: 'connecting', error: undefined });

    try {
      await connector.connect();
      const currentStatus = connectorStatuses.get(connectorKey);

      if (currentStatus?.state === 'connecting') {
        setConnectorStatus(connectorKey, connector, { state: 'connected' });
      }
    } catch (error) {
      setConnectorStatus(connectorKey, connector, {
        state: 'error',
        error: error.message,
      });
    }
  };

  const replaceConnector = async (connector) => {
    validateConnector(connector);
    const connectorKey = getConnectorKey(connector);

    await removeConnector(connectorKey);

    registerConnector(connector);
    await startConnector(connector);
  };

  const replacePlatformConnectors = async (
    platform,
    nextConnectors = [],
    { replaceExisting = false, waitForStart = false } = {},
  ) => {
    const nextConnectorEntries = nextConnectors.map((connector) => ({
      connector,
      key: getConnectorKey(connector),
    }));
    const nextConnectorKeys = new Set(nextConnectorEntries.map(({ key }) => key));

    for (const connectorKey of [...(connectorKeysByPlatform.get(platform) ?? [])]) {
      if (!replaceExisting && nextConnectorKeys.has(connectorKey)) {
        continue;
      }

      await removeConnector(connectorKey);
    }

    const startPromises = [];

    for (const { connector, key } of nextConnectorEntries) {
      if (registeredConnectors.has(key)) {
        continue;
      }

      registerConnector(connector);
      startPromises.push(startConnector(connector));
    }

    if (waitForStart) {
      await Promise.all(startPromises);
    } else {
      void Promise.all(startPromises);
    }
  };

  for (const connector of connectors) {
    registerConnector(connector);
  }

  return {
    registerConnector,
    onMessage: (listener) => {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    onStatus: (listener) => {
      events.on('status', listener);
      return () => events.off('status', listener);
    },
    start: async () => {
      for (const connector of registeredConnectors.values()) {
        await startConnector(connector);
      }
    },
    stop: async () => {
      for (const [connectorKey, connector] of registeredConnectors) {
        await connector.disconnect();
        setConnectorStatus(connectorKey, connector, { state: 'disconnected' });
        unsubscribeConnector(connectorKey);
      }
    },
    removeConnector,
    replaceConnector,
    replacePlatformConnectors,
    sendMessage: async ({ platform, text } = {}) => {
      const normalizedPlatform = normalizeSendPlatform(platform);
      const normalizedText = normalizeSendText(text);
      const connectorKey = connectorKeysByPlatform.get(normalizedPlatform)?.values().next().value;
      const connector = registeredConnectors.get(connectorKey);

      if (!connector) {
        throw new Error(`Connector is not active: ${normalizedPlatform}.`);
      }

      try {
        await connector.send(normalizedText);
        return {
          platform: normalizedPlatform,
          text: normalizedText,
          sentAt: new Date().toISOString(),
        };
      } catch (error) {
        setConnectorStatus(connectorKey, connector, {
          state: 'error',
          error: error.message,
        });
        throw error;
      }
    },
    getStatuses: () => [...connectorStatuses.values()],
  };

  function registerPlatformKey(platform, connectorKey) {
    const connectorKeys = connectorKeysByPlatform.get(platform) ?? new Set();

    connectorKeys.add(connectorKey);
    connectorKeysByPlatform.set(platform, connectorKeys);
  }

  function unregisterPlatformKey(platform, connectorKey) {
    const connectorKeys = connectorKeysByPlatform.get(platform);

    if (!connectorKeys) {
      return;
    }

    connectorKeys.delete(connectorKey);

    if (connectorKeys.size === 0) {
      connectorKeysByPlatform.delete(platform);
    }
  }
};

const getConnectorDetails = (connector) => ({
  channel: connector.channel,
  liveUrl: connector.liveUrl,
});

const resolveConnectorSource = (connector) => connector.source ?? createConnectorSource(connector);

const getConnectorKey = (connector, connectorSource = resolveConnectorSource(connector)) =>
  connectorSource?.sourceId ?? connector.sourceId ?? connector.platform;

const normalizeSendPlatform = (platform) => {
  if (typeof platform !== 'string' || platform.trim().length === 0) {
    throw new TypeError('Send target platform is required.');
  }

  return platform.trim().toLowerCase();
};

const normalizeSendText = (text) => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('Message text is required.');
  }

  return text.trim();
};

module.exports = {
  createChatHub,
};
