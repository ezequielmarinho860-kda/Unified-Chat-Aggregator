const { EventEmitter } = require('node:events');
const { normalizeChatMessage } = require('./chat-message');
const { validateConnector } = require('./connectors/connector-contract');
const { createConnectorSource } = require('./source-identity');

const createChatHub = ({ connectors = [] } = {}) => {
  const events = new EventEmitter();
  const registeredConnectors = new Map();
  const connectorSubscriptions = new Map();
  const connectorStatuses = new Map();

  const setConnectorStatus = (platform, patch) => {
    const previousStatus = connectorStatuses.get(platform) ?? {
      platform,
      state: 'disabled',
      messageCount: 0,
      lastMessageAt: undefined,
      error: undefined,
      details: {},
    };
    const nextStatus = {
      ...previousStatus,
      ...patch,
      platform,
    };

    connectorStatuses.set(platform, nextStatus);
    events.emit('status', nextStatus);
  };

  const publishMessage = (message, connectorSource) => {
    const normalizedMessage = normalizeChatMessage({
      ...message,
      source: message?.source ?? connectorSource,
    });
    const previousStatus = connectorStatuses.get(normalizedMessage.platform);

    if (previousStatus) {
      setConnectorStatus(normalizedMessage.platform, {
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

    if (registeredConnectors.has(connector.platform)) {
      throw new Error(`Connector already registered: ${connector.platform}`);
    }

    registeredConnectors.set(connector.platform, connector);
    connectorSubscriptions.set(connector.platform, []);
    setConnectorStatus(connector.platform, {
      state: 'idle',
      details: getConnectorDetails(connector),
    });

    if (typeof connector.onMessage === 'function') {
      const connectorSource = createConnectorSource(connector);

      connectorSubscriptions
        .get(connector.platform)
        .push(connector.onMessage((message) => publishMessage(message, connectorSource)));
    }

    if (typeof connector.onError === 'function') {
      connectorSubscriptions.get(connector.platform).push(
        connector.onError((error) => {
          setConnectorStatus(connector.platform, {
            state: 'error',
            error: error.message,
          });
        }),
      );
    }

    if (typeof connector.onStatus === 'function') {
      connectorSubscriptions.get(connector.platform).push(
        connector.onStatus((status) => {
          setConnectorStatus(connector.platform, {
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

  const unsubscribeConnector = (platform) => {
    const subscriptions = connectorSubscriptions.get(platform) ?? [];

    while (subscriptions.length > 0) {
      const unsubscribe = subscriptions.pop();
      unsubscribe();
    }

    connectorSubscriptions.delete(platform);
  };

  const removeConnector = async (platform) => {
    const connector = registeredConnectors.get(platform);

    if (!connector) {
      return false;
    }

    await connector.disconnect();
    unsubscribeConnector(platform);
    registeredConnectors.delete(platform);
    connectorStatuses.delete(platform);
    events.emit('status', {
      platform,
      state: 'disabled',
      messageCount: 0,
      lastMessageAt: undefined,
      error: undefined,
      details: {},
    });
    return true;
  };

  const startConnector = async (connector) => {
    setConnectorStatus(connector.platform, { state: 'connecting', error: undefined });

    try {
      await connector.connect();
      const currentStatus = connectorStatuses.get(connector.platform);

      if (currentStatus?.state === 'connecting') {
        setConnectorStatus(connector.platform, { state: 'connected' });
      }
    } catch (error) {
      setConnectorStatus(connector.platform, {
        state: 'error',
        error: error.message,
      });
    }
  };

  const replaceConnector = async (connector) => {
    validateConnector(connector);

    await removeConnector(connector.platform);

    registerConnector(connector);
    await startConnector(connector);
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
      for (const connector of registeredConnectors.values()) {
        await connector.disconnect();
        setConnectorStatus(connector.platform, { state: 'disconnected' });
        unsubscribeConnector(connector.platform);
      }
    },
    removeConnector,
    replaceConnector,
    sendMessage: async ({ platform, text } = {}) => {
      const normalizedPlatform = normalizeSendPlatform(platform);
      const normalizedText = normalizeSendText(text);
      const connector = registeredConnectors.get(normalizedPlatform);

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
        setConnectorStatus(normalizedPlatform, {
          state: 'error',
          error: error.message,
        });
        throw error;
      }
    },
    getStatuses: () => [...connectorStatuses.values()],
  };
};

const getConnectorDetails = (connector) => ({
  channel: connector.channel,
  liveUrl: connector.liveUrl,
});

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
