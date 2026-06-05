const normalizeChatMessage = (message) => {
  if (!message || typeof message !== 'object') {
    throw new TypeError('Chat message must be an object.');
  }

  const normalized = {
    id: requireString(message.id, 'id'),
    platform: requireString(message.platform, 'platform'),
    author: normalizeAuthor(message.author),
    text: requireString(message.text, 'text'),
    timestamp: requireString(message.timestamp, 'timestamp'),
    avatarUrl: optionalString(message.avatarUrl),
    raw: message.raw ?? null,
  };

  return normalized;
};

const normalizeAuthor = (author) => {
  if (!author || typeof author !== 'object') {
    throw new TypeError('Chat message author must be an object.');
  }

  return {
    id: requireString(author.id, 'author.id'),
    name: requireString(author.name, 'author.name'),
    avatarUrl: optionalString(author.avatarUrl),
    badges: normalizeBadges(author.badges),
  };
};

const normalizeBadges = (badges) => {
  if (badges === undefined || badges === null) {
    return [];
  }

  if (!Array.isArray(badges)) {
    throw new TypeError('Chat message author badges must be an array.');
  }

  return badges.map(normalizeBadge);
};

const normalizeBadge = (badge) => {
  if (!badge || typeof badge !== 'object') {
    throw new TypeError('Chat message author badge must be an object.');
  }

  return {
    id: requireString(badge.id, 'author.badges.id'),
    label: requireString(badge.label, 'author.badges.label'),
    version: optionalString(badge.version),
    imageUrl: optionalString(badge.imageUrl),
  };
};

const requireString = (value, fieldName) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Chat message ${fieldName} must be a non-empty string.`);
  }

  return value;
};

const optionalString = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new TypeError('Optional chat message fields must be strings.');
  }

  return value;
};

module.exports = {
  normalizeChatMessage,
};
