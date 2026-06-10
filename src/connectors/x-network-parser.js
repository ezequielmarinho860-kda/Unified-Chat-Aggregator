const { parseViewerCountText } = require('../viewer-counts');

const MESSAGE_TEXT_KEYS = new Set([
  'body',
  'content',
  'full_text',
  'message',
  'text',
]);
const AUTHOR_KEYS = new Set([
  'author',
  'from',
  'participant',
  'profile',
  'publisher',
  'sender',
  'user',
]);
const REPLY_KEYS = new Set([
  'reply',
  'replyTo',
  'reply_to',
  'replyMetadata',
  'reply_metadata',
  'inReplyTo',
  'in_reply_to',
  'in_reply_to_status',
  'quotedStatus',
  'quoted_status',
]);
const MAX_MESSAGE_TEXT_LENGTH = 500;
const MAX_TRAVERSE_NODES = 5_000;

const extractXNetworkEvents = (payload, { url = '' } = {}) => {
  const parsed = parseNetworkPayload(payload);

  if (parsed === undefined || !isLikelyXRealtimePayload(parsed, url)) {
    return { messages: [], viewerCount: undefined };
  }

  return {
    messages: extractXNetworkMessages(parsed),
    viewerCount: extractXNetworkViewerCount(parsed),
    viewerCountDebug: extractXNetworkViewerCountMatch(parsed),
  };
};

const extractXNetworkMessages = (root) => {
  const messages = [];
  const seenKeys = new Set();

  traverse(root, (node, traverseKey) => {
    if (!isRecord(node)) {
      return;
    }

    if (isReplyContainerKey(traverseKey)) {
      return;
    }

    const text = getMessageText(node);

    if (!isValidMessageText(text)) {
      return;
    }

    const author = getAuthor(node);

    if (!author.authorName && !author.username) {
      return;
    }

    const reply = getReply(node);
    const message = {
      authorName: author.authorName || author.username,
      avatarUrl: author.avatarUrl,
      id: getMessageId(node),
      text,
      timestamp: getTimestamp(node),
      username: author.username,
    };
    if (reply) {
      message.reply = reply;
    }
    const messageKey = [message.id, message.username, message.authorName, message.text]
      .filter(Boolean)
      .join('|');

    if (seenKeys.has(messageKey)) {
      return;
    }

    seenKeys.add(messageKey);
    messages.push(message);
  });

  return messages;
};

const extractXNetworkViewerCount = (root) => {
  const match = extractXNetworkViewerCountMatch(root);

  return match?.count;
};

const extractXNetworkViewerCountMatch = (root) => {
  let viewerCountMatch;

  traverse(root, (node, key) => {
    if (viewerCountMatch !== undefined) {
      return;
    }

    if (typeof node === 'number' && isViewerCountKey(key)) {
      viewerCountMatch = {
        count: node,
        key: String(key || ''),
        source: 'network-number',
        value: node,
      };
      return;
    }

    if (typeof node === 'string' && (isViewerCountKey(key) || /viewer|watching/i.test(node))) {
      const count = parseViewerCountText(node);

      if (count !== undefined) {
        viewerCountMatch = {
          count,
          key: String(key || ''),
          source: 'network-string',
          value: node.slice(0, 500),
        };
      }
    }
  });

  return viewerCountMatch;
};

const parseNetworkPayload = (payload) => {
  if (payload === undefined || payload === null) {
    return undefined;
  }

  if (typeof payload === 'object') {
    return payload;
  }

  if (typeof payload !== 'string') {
    return undefined;
  }

  return parseJsonLikeString(payload);
};

const isLikelyXRealtimePayload = (_payload, url = '') => {
  if (!url) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);

    return ['x.com', 'twitter.com', 'pscp.tv', 'periscope.tv'].some(
      (host) => parsedUrl.hostname === host || parsedUrl.hostname.endsWith(`.${host}`),
    );
  } catch {
    return /\/(graphql|i\/api|live|broadcast|chat|timeline|chatapi)\b/i.test(url);
  }
};

const getMessageText = (node) => {
  for (const key of MESSAGE_TEXT_KEYS) {
    const value = node[key];

    if (typeof value === 'string' && isValidMessageText(value)) {
      return value.trim();
    }
  }

  if (isRecord(node.legacy) && typeof node.legacy.full_text === 'string') {
    return node.legacy.full_text.trim();
  }

  if (isRecord(node.message)) {
    const text = node.message.text ?? node.message.body ?? node.message.content;

    if (typeof text === 'string' && isValidMessageText(text)) {
      return text.trim();
    }
  }

  return undefined;
};

const getAuthor = (node) => {
  const directAuthor = normalizeAuthor(node);

  if (directAuthor.authorName || directAuthor.username) {
    return directAuthor;
  }

  for (const key of AUTHOR_KEYS) {
    const author = normalizeAuthor(node[key]);

    if (author.authorName || author.username) {
      return author;
    }
  }

  const coreAuthor = normalizeAuthor(node.core?.user_results?.result);

  if (coreAuthor.authorName || coreAuthor.username) {
    return coreAuthor;
  }

  const resultAuthor = normalizeAuthor(node.user_results?.result);

  if (resultAuthor.authorName || resultAuthor.username) {
    return resultAuthor;
  }

  return {};
};

const normalizeAuthor = (value) => {
  if (!isRecord(value)) {
    return {};
  }

  const legacy = isRecord(value.legacy) ? value.legacy : value;

  return {
    authorName: normalizeString(
      value.authorName ??
        value.displayName ??
        value.display_name ??
        value.name ??
        legacy.name,
    ),
    avatarUrl: normalizeAvatarUrl(value),
    username: normalizeUsername(
      value.username ??
        value.screenName ??
        value.screen_name ??
        legacy.screen_name,
    ),
  };
};

const normalizeAvatarUrl = (value) => {
  if (!isRecord(value)) {
    return undefined;
  }

  const legacy = isRecord(value.legacy) ? value.legacy : undefined;
  const directUrl = firstNormalizedString(
    value.avatarUrl,
    value.avatar_url,
    value.profile_image_url_https,
    value.profile_image_url,
    value.profileImageUrl,
    value.profilePictureUrl,
    value.profilePic,
    value.profile_pic,
    legacy?.avatarUrl,
    legacy?.avatar_url,
    legacy?.profile_image_url_https,
    legacy?.profile_image_url,
    legacy?.profileImageUrl,
    legacy?.profilePictureUrl,
    legacy?.profilePic,
    legacy?.profile_pic,
  );

  if (directUrl) {
    return directUrl;
  }

  for (const nestedValue of [
    value.author,
    value.profile,
    value.participant,
    value.sender,
    value.user,
    value.user_results?.result,
    value.core?.user_results?.result,
  ]) {
    const nestedUrl = normalizeAvatarUrl(nestedValue);

    if (nestedUrl) {
      return nestedUrl;
    }
  }

  for (const nestedValue of [value.image, value.avatar, value.photo, value.picture]) {
    if (!isRecord(nestedValue)) {
      continue;
    }

    const imageUrl = firstNormalizedString(
      nestedValue.url,
      nestedValue.src,
      nestedValue.href,
      nestedValue.imageUrl,
      nestedValue.image_url,
    );

    if (imageUrl) {
      return imageUrl;
    }
  }

  return undefined;
};

const getMessageId = (node) =>
  normalizeString(
    node.id_str ??
      node.id ??
      node.rest_id ??
      node.uuid ??
      node.remoteID ??
      node.messageId ??
      node.message_id ??
      node.sortIndex,
  );

const getTimestamp = (node) =>
  normalizeString(
    node.created_at ??
      node.createdAt ??
      node.timestamp ??
      node.time ??
      node.legacy?.created_at,
  );

const getReply = (node) => {
  const containers = [node, node.message, node.legacy];

  for (const container of containers) {
    if (!isRecord(container)) {
      continue;
    }

    for (const key of REPLY_KEYS) {
      const reply = normalizeReply(container[key]);

      if (reply) {
        return reply;
      }
    }
  }

  return undefined;
};

const isValidMessageText = (value) => {
  const text = normalizeString(value);

  return Boolean(
    text &&
      text.length <= MAX_MESSAGE_TEXT_LENGTH &&
      parseJsonLikeString(text) === undefined &&
      !/^https?:\/\//i.test(text) &&
      !/^\d+$/.test(text),
  );
};

const isViewerCountKey = (key) =>
  /viewer|watching|audience|participant|watcher|live[_-]?view/i.test(String(key || '')) &&
  /(count|total|number|viewers|watching|audience|participant|watcher|n_)/i.test(String(key || '')) &&
  !/index/i.test(String(key || ''));

const traverse = (root, visit) => {
  const stack = [{ key: undefined, value: root }];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_TRAVERSE_NODES) {
    const { key, value } = stack.pop();

    visited += 1;
    visit(value, key);

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ key: index, value: value[index] });
      }
    } else if (isRecord(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        stack.push({ key: childKey, value: childValue });
      }
    } else if (typeof value === 'string') {
      const embedded = parseJsonLikeString(value);

      if (embedded !== undefined) {
        stack.push({ key, value: embedded });
      }
    }
  }
};

const isRecord = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeString = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
};

const firstNormalizedString = (...values) => {
  for (const value of values) {
    const normalized = normalizeString(value);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
};

const normalizeUsername = (value) => normalizeString(value)?.replace(/^@+/, '');

const isReplyContainerKey = (key) => /reply|quoted/i.test(String(key || ''));

const normalizeReply = (value) => {
  if (typeof value === 'string') {
    const text = normalizeString(value);

    return text ? { text } : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const legacy = isRecord(value.legacy) ? value.legacy : value;
  const text = normalizeString(
    value.text ??
      value.body ??
      value.content ??
      value.full_text ??
      legacy.text ??
      legacy.body ??
      legacy.content ??
      legacy.full_text,
  );
  const reply = {
    authorName: normalizeString(
      value.authorName ??
        value.displayName ??
        value.display_name ??
        value.name ??
        legacy.name ??
        legacy.display_name,
    ),
    text,
    username: normalizeUsername(
      value.username ??
        value.screenName ??
        value.screen_name ??
        legacy.screen_name ??
        legacy.display_name,
    ),
  };

  return reply.authorName || reply.username || reply.text ? reply : undefined;
};

const parseJsonLikeString = (value) => {
  const normalized = normalizeTransportText(value);

  if (!normalized) {
    return undefined;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    const chunks = normalized
      .split(/\r?\n/)
      .map((line) => normalizeTransportText(line))
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      })
      .filter((line) => line !== undefined);

    return chunks.length > 0 ? chunks : undefined;
  }
};

const normalizeTransportText = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().replace(/^\)\]\}',?\s*/, '').replace(/^for\s*\(;;\);\s*/, '');

  if (!trimmed) {
    return undefined;
  }

  const dataLine = trimmed.match(/^data:\s*(.+)$/is);
  const candidate = dataLine ? dataLine[1].trim() : trimmed;

  return candidate.startsWith('{') || candidate.startsWith('[') ? candidate : undefined;
};

module.exports = {
  extractXNetworkEvents,
  extractXNetworkMessages,
  extractXNetworkViewerCount,
  extractXNetworkViewerCountMatch,
};
