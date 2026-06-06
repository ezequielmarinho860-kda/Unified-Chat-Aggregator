(() => {
const ACCOUNT_CHARACTERS = 'A-Za-z0-9_';

const createLoggedIdentity = (auth = {}) => {
  if (!auth.connected) {
    return undefined;
  }

  const id = normalizeAccountValue(auth.userId);
  const login = normalizeAccountValue(auth.login);
  const displayName = normalizeAccountValue(auth.displayName);

  if (!id && !login && !displayName) {
    return undefined;
  }

  return { id, login, displayName };
};

const createIdentityFromMessageAuthor = (message) => {
  const id = normalizeAccountValue(message?.author?.id);
  const displayName = normalizeAccountValue(message?.author?.name);

  if (!id && !displayName) {
    return undefined;
  }

  return {
    id,
    login: id,
    displayName,
  };
};

const isMessageFromIdentity = (message, identity) => {
  if (!identity) {
    return false;
  }

  const authorId = normalizeAccountValue(message?.author?.id);
  const authorName = normalizeAccountValue(message?.author?.name);

  return Boolean(
    (identity.id && authorId === identity.id) ||
      (identity.login && [authorId, authorName].includes(identity.login)) ||
      (identity.displayName && authorName === identity.displayName),
  );
};

const doesMessageMentionIdentity = (message, identity) => {
  if (!identity || typeof message?.text !== 'string') {
    return false;
  }

  const accountNames = [...new Set([identity.login].filter(Boolean))];

  return accountNames.some((accountName) => {
    const escapedAccountName = escapeRegExp(accountName);
    const pattern = new RegExp(
      `(^|[^${ACCOUNT_CHARACTERS}])@${escapedAccountName}(?![${ACCOUNT_CHARACTERS}])`,
      'i',
    );

    return pattern.test(message.text);
  });
};

const splitTextByMention = (text, identities = []) => {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }

  const accountNames = [...new Set(identities.map((identity) => identity?.login).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);

  if (accountNames.length === 0) {
    return [{ type: 'text', text }];
  }

  const pattern = new RegExp(
    `(^|[^${ACCOUNT_CHARACTERS}])(@(?:${accountNames.join('|')}))(?![${ACCOUNT_CHARACTERS}])`,
    'gi',
  );
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text))) {
    const mentionStart = match.index + match[1].length;

    if (mentionStart > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, mentionStart) });
    }

    parts.push({ type: 'mention', text: match[2] });
    cursor = mentionStart + match[2].length;
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', text }];
};

const normalizeAccountValue = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/^@+/, '').toLowerCase();
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const messageHighlights = {
  createIdentityFromMessageAuthor,
  createLoggedIdentity,
  doesMessageMentionIdentity,
  isMessageFromIdentity,
  splitTextByMention,
};

if (typeof window !== 'undefined') {
  window.messageHighlights = messageHighlights;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = messageHighlights;
}
})();
