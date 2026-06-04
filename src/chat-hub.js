const { EventEmitter } = require('node:events');
const { normalizeChatMessage } = require('./chat-message');
const { validateConnector } = require('./connectors/connector-contract');

const createChatHub = ({ connectors = [] } = {}) => {
  const events = new EventEmitter();
  const registeredConnectors = new Map();
  const unsubscribeHandlers = [];

  const publishMessage = (message) => {
    events.emit('message', normalizeChatMessage(message));
  };

  const registerConnector = (connector) => {
    validateConnector(connector);

    if (registeredConnectors.has(connector.platform)) {
      throw new Error(`Connector already registered: ${connector.platform}`);
    }

    registeredConnectors.set(connector.platform, connector);

    if (typeof connector.onMessage === 'function') {
      unsubscribeHandlers.push(connector.onMessage(publishMessage));
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
    start: async () => {
      for (const connector of registeredConnectors.values()) {
        await connector.connect();
      }
    },
    stop: async () => {
      for (const connector of registeredConnectors.values()) {
        await connector.disconnect();
      }

      while (unsubscribeHandlers.length > 0) {
        const unsubscribe = unsubscribeHandlers.pop();
        unsubscribe();
      }
    },
  };
};

module.exports = {
  createChatHub,
};
