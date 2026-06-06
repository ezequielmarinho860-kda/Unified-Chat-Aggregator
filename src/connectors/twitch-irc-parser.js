const { normalizeChatMessage } = require('../chat-message');

const IRC_TAG_ESCAPES = new Map([
  ['s', ' '],
  [':', ';'],
  ['\\', '\\'],
  ['r', '\r'],
  ['n', '\n'],
]);
const TWITCH_EMOTE_IMAGE_URL = 'https://static-cdn.jtvnw.net/emoticons/v2';

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

const parseTwitchPrivmsg = (line, { badgeCatalog = {}, bttvEmoteCatalog = {} } = {}) => {
  const parsed = parseTwitchIrcLine(line);

  if (parsed.command !== 'PRIVMSG') {
    return undefined;
  }

  const username = getUsernameFromPrefix(parsed.prefix);
  const displayName = parsed.tags['display-name'] || username || 'unknown';
  const timestamp = parsed.tags['tmi-sent-ts']
    ? new Date(Number(parsed.tags['tmi-sent-ts'])).toISOString()
    : new Date().toISOString();

  const text = parsed.trailing || '';

  return normalizeChatMessage({
    id: parsed.tags.id || `twitch-${Date.now()}-${displayName}`,
    platform: 'twitch',
    author: {
      id: parsed.tags['user-id'] || username || displayName,
      name: displayName,
      badges: parseTwitchBadges(parsed.tags.badges, badgeCatalog),
    },
    text,
    fragments: applyBttvEmotesToFragments(
      parseTwitchEmoteFragments(text, parsed.tags.emotes),
      bttvEmoteCatalog,
    ),
    timestamp,
    raw: parsed,
  });
};

const applyBttvEmotesToFragments = (fragments, catalog = {}) =>
  fragments.flatMap((fragment) => {
    if (fragment.type !== 'text') {
      return [fragment];
    }

    return fragment.text
      .split(/(\s+)/u)
      .filter((token) => token.length > 0)
      .map((token) => {
        const emote = catalog[token];

        if (!emote) {
          return { type: 'text', text: token };
        }

        return {
          type: 'emote',
          id: `bttv:${emote.id}`,
          text: token,
          imageUrl: emote.imageUrl,
        };
      });
  });

const parseTwitchEmoteFragments = (text, rawEmotes = '') => {
  if (!rawEmotes) {
    return [{ type: 'text', text }];
  }

  const ranges = parseTwitchEmoteRanges(rawEmotes, text);

  if (ranges.length === 0) {
    return [{ type: 'text', text }];
  }

  const fragments = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }

    if (range.start > cursor) {
      fragments.push({ type: 'text', text: text.slice(cursor, range.start) });
    }

    fragments.push({
      type: 'emote',
      id: range.id,
      text: text.slice(range.start, range.end + 1),
      imageUrl: createTwitchEmoteImageUrl(range.id),
    });
    cursor = range.end + 1;
  }

  if (cursor < text.length) {
    fragments.push({ type: 'text', text: text.slice(cursor) });
  }

  return fragments.filter((fragment) => fragment.text.length > 0);
};

const parseTwitchEmoteRanges = (rawEmotes, text) =>
  rawEmotes
    .split('/')
    .filter(Boolean)
    .flatMap((entry) => {
      const [id, rawRanges = ''] = entry.split(':');

      return rawRanges
        .split(',')
        .filter(Boolean)
        .map((range) => {
          const [start, end] = range.split('-').map(Number);

          if (!id || !Number.isInteger(start) || !Number.isInteger(end)) {
            return undefined;
          }

          if (start < 0 || end < start || end >= text.length) {
            return undefined;
          }

          return { id, start, end };
        })
        .filter(Boolean);
    })
    .sort((left, right) => left.start - right.start);

const createTwitchEmoteImageUrl = (id) =>
  `${TWITCH_EMOTE_IMAGE_URL}/${encodeURIComponent(id)}/default/dark/2.0`;

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
  applyBttvEmotesToFragments,
  parseTwitchIrcLine,
  parseTwitchBadges,
  parseTwitchEmoteFragments,
  parseTwitchPrivmsg,
};
