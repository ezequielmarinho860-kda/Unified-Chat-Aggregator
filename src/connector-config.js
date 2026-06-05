const DEFAULT_CONNECTORS = ['mock', 'kick', 'twitch'];
const KNOWN_CONNECTORS = new Set(['mock', 'kick', 'twitch', 'x']);

const resolveEnabledConnectors = (value, { includeXWhenConfigured = false } = {}) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (includeXWhenConfigured) {
      return [...DEFAULT_CONNECTORS, 'x'];
    }

    return DEFAULT_CONNECTORS;
  }

  const connectors = value
    .split(',')
    .map((connector) => connector.trim().toLowerCase())
    .filter(Boolean);

  for (const connector of connectors) {
    if (!KNOWN_CONNECTORS.has(connector)) {
      throw new TypeError(`Unknown connector: ${connector}.`);
    }
  }

  return [...new Set(connectors)];
};

module.exports = {
  DEFAULT_CONNECTORS,
  resolveEnabledConnectors,
};
