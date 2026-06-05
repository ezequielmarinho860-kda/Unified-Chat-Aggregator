const { normalizeChatMessage } = require('../chat-message');

const IRC_TAG_ESCAPES = new Map([
  ['s', ' '],
  [':', ';'],
  ['\\', '\\'],
  ['r', '\r'],
  ['n', '\n'],
]);

const parseTwitchIrcLine = (line) => {
  if (typeof line !== 'string' || line.length === 0) {
    throw new TypeError('IRC line must be a non-empty string.');
  }

  let remaining = line.trim();
  const tags = {};
  let prefix;

  if (remaining.startsWith('@')) {
    const tagEndIndex = remaining.indexOf(' ');
    const rawTags = remaining.slice(1, tagEndIndex);
    remaining = remaining.slice(tagEndIndex + 1);

    for (const tag of rawTags.split(';')) {
      const [key, value = ''] = tag.split('=');
      tags[key] = decodeIrcTagValue(value);
    }
  }

  if (remaining.startsWith(':')) {
    const prefixEndIndex = remaining.indexOf(' ');
    prefix = remaining.slice(1, prefixEndIndex);
    remaining = remaining.slice(prefixEndIndex + 1);
  }

  const trailingIndex = remaining.indexOf(' :');
  const withoutTrailing =
    trailingIndex === -1 ? remaining : remaining.slice(0, trailingIndex);
  const trailing =
    trailingIndex === -1 ? undefined : remaining.slice(trailingIndex + 2);
  const [command, ...params] = withoutTrailing.split(' ').filter(Boolean);

  return {
    tags,
    prefix,
    command,
    params,
    trailing,
    raw: line,
  };
};

const parseTwitchPrivmsg = (line, { badgeCatalog = {} } = {}) => {
  const parsed = parseTwitchIrcLine(line);

  if (parsed.command !== 'PRIVMSG') {
    return undefined;
  }

  const username = getUsernameFromPrefix(parsed.prefix);
  const displayName = parsed.tags['display-name'] || username || 'unknown';
  const timestamp = parsed.tags['tmi-sent-ts']
    ? new Date(Number(parsed.tags['tmi-sent-ts'])).toISOString()
    : new Date().toISOString();

  return normalizeChatMessage({
    id: parsed.tags.id || `twitch-${Date.now()}-${displayName}`,
    platform: 'twitch',
    author: {
      id: parsed.tags['user-id'] || username || displayName,
      name: displayName,
      badges: parseTwitchBadges(parsed.tags.badges, badgeCatalog),
    },
    text: parsed.trailing || '',
    timestamp,
    raw: parsed,
  });
};

const parseTwitchBadges = (rawBadges = '', badgeCatalog = {}) => {
  if (!rawBadges) {
    return [];
  }

  return rawBadges
    .split(',')
    .filter(Boolean)
    .map((badge) => {
      const [id, version = '1'] = badge.split('/');
      const metadata = badgeCatalog?.[id]?.[version];

      return {
        id,
        label: metadata?.label ?? getTwitchBadgeLabel(id),
        version,
        imageUrl: metadata?.imageUrl,
      };
    });
};

const getTwitchBadgeLabel = (badgeId) => {
  const labels = {
    broadcaster: 'Broadcaster',
    founder: 'Founder',
    moderator: 'Mod',
    premium: 'Prime',
    staff: 'Staff',
    subscriber: 'Sub',
    turbo: 'Turbo',
    vip: 'VIP',
  };

  return labels[badgeId] ?? badgeId;
};

const decodeIrcTagValue = (value) =>
  value.replaceAll(/\\(.)/g, (_match, escapedCharacter) => {
    return IRC_TAG_ESCAPES.get(escapedCharacter) ?? escapedCharacter;
  });

const getUsernameFromPrefix = (prefix) => {
  if (!prefix) {
    return undefined;
  }

  return prefix.split('!')[0];
};

module.exports = {
  parseTwitchIrcLine,
  parseTwitchBadges,
  parseTwitchPrivmsg,
};
