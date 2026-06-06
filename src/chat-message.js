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

  if (message.fragments !== undefined && message.fragments !== null) {
    normalized.fragments = normalizeFragments(message.fragments);
  }

  if (message.source !== undefined && message.source !== null) {
    normalized.source = normalizeSource(message.source);

    if (normalized.source.platform !== normalized.platform) {
      throw new TypeError('Chat message source platform must match message platform.');
    }
  }

  return normalized;
};

const normalizeSource = (source) => {
  if (!source || typeof source !== 'object') {
    throw new TypeError('Chat message source must be an object.');
  }

  return {
    sourceId: requireString(source.sourceId, 'source.sourceId'),
    platform: requireString(source.platform, 'source.platform'),
    broadcasterName: optionalString(source.broadcasterName),
    channelLabel: optionalString(source.channelLabel),
  };
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

const normalizeFragments = (fragments) => {
  if (!Array.isArray(fragments)) {
    throw new TypeError('Chat message fragments must be an array.');
  }

  return fragments.map(normalizeFragment);
};

const normalizeFragment = (fragment) => {
  if (!fragment || typeof fragment !== 'object') {
    throw new TypeError('Chat message fragment must be an object.');
  }

  const type = requireString(fragment.type, 'fragments.type');
  const normalizedFragment = {
    type,
    text: requireString(fragment.text, 'fragments.text'),
  };

  if (fragment.id !== undefined && fragment.id !== null) {
    normalizedFragment.id = optionalString(fragment.id);
  }

  if (fragment.imageUrl !== undefined && fragment.imageUrl !== null) {
    normalizedFragment.imageUrl = optionalString(fragment.imageUrl);
  }

  return normalizedFragment;
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
