const CONNECTOR_METHODS = ['connect', 'disconnect', 'send'];

/**
 * @typedef {'twitch' | 'kick' | 'x' | 'youtube' | 'mock'} Platform
 *
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {Platform} platform
 * @property {Object} author
 * @property {string} author.id
 * @property {string} author.name
 * @property {string | undefined} author.avatarUrl
 * @property {string} text
 * @property {string} timestamp
 * @property {unknown} raw
 *
 * @typedef {Object} ChatConnector
 * @property {Platform} platform
 * @property {((listener: (message: ChatMessage) => void) => () => void) | undefined} onMessage
 * @property {() => Promise<void>} connect
 * @property {() => Promise<void>} disconnect
 * @property {(text: string) => Promise<void>} send
 */

const validateConnector = (connector) => {
  if (!connector || typeof connector !== 'object') {
    throw new TypeError('Connector must be an object.');
  }

  if (typeof connector.platform !== 'string' || connector.platform.length === 0) {
    throw new TypeError('Connector must declare a platform.');
  }

  for (const method of CONNECTOR_METHODS) {
    if (typeof connector[method] !== 'function') {
      throw new TypeError(`Connector must implement ${method}().`);
    }
  }

  return connector;
};

module.exports = {
  CONNECTOR_METHODS,
  validateConnector,
};
