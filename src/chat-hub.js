const { EventEmitter } = require('node:events');
const { normalizeChatMessage } = require('./chat-message');
const { validateConnector } = require('./connectors/connector-contract');

const createChatHub = ({ connectors = [] } = {}) => {
  const events = new EventEmitter();
  const registeredConnectors = new Map();
  const unsubscribeHandlers = [];
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

  const publishMessage = (message) => {
    const normalizedMessage = normalizeChatMessage(message);
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
    setConnectorStatus(connector.platform, {
      state: 'idle',
      details: getConnectorDetails(connector),
    });

    if (typeof connector.onMessage === 'function') {
      unsubscribeHandlers.push(connector.onMessage(publishMessage));
    }

    if (typeof connector.onError === 'function') {
      unsubscribeHandlers.push(
        connector.onError((error) => {
          setConnectorStatus(connector.platform, {
            state: 'error',
            error: error.message,
          });
        }),
      );
    }

    if (typeof connector.onStatus === 'function') {
      unsubscribeHandlers.push(
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
      }
    },
    stop: async () => {
      for (const connector of registeredConnectors.values()) {
        await connector.disconnect();
        setConnectorStatus(connector.platform, { state: 'disconnected' });
      }

      while (unsubscribeHandlers.length > 0) {
        const unsubscribe = unsubscribeHandlers.pop();
        unsubscribe();
      }
    },
    getStatuses: () => [...connectorStatuses.values()],
  };
};

const getConnectorDetails = (connector) => ({
  channel: connector.channel,
  liveUrl: connector.liveUrl,
});

module.exports = {
  createChatHub,
};
