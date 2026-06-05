const { normalizeChatMessage } = require('../chat-message');

const normalizeXMessage = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('X message payload must be an object.');
  }

  const authorName = requirePayloadString(payload.authorName, 'authorName');
  const text = requirePayloadString(payload.text, 'text');
  const username = normalizeOptionalUsername(payload.username);

  return normalizeChatMessage({
    id: createXMessageId(payload, username || authorName, text),
    platform: 'x',
    author: {
      id: username || authorName,
      name: authorName,
      avatarUrl: normalizeOptionalString(payload.avatarUrl),
    },
    text,
    timestamp: normalizeTimestamp(payload.timestamp),
    raw: payload,
  });
};

const createXMessageId = (payload, authorKey, text) => {
  if (payload.id) {
    return String(payload.id);
  }

  return `x-${hashStableParts([
    authorKey,
    text,
    normalizeOptionalString(payload.avatarUrl) || '',
  ])}`;
};

const hashStableParts = (parts) => {
  const value = parts.join('|');
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
};

const normalizeTimestamp = (timestamp) => {
  if (!timestamp) {
    return new Date().toISOString();
  }

  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
};

const requirePayloadString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`X message ${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
};

const normalizeOptionalUsername = (value) => {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return undefined;
  }

  return normalized.replace(/^@+/, '');
};

module.exports = {
  normalizeXMessage,
};
