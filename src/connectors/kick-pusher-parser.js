const { normalizeChatMessage } = require('../chat-message');

const KICK_CHAT_MESSAGE_EVENT = 'App\\Events\\ChatMessageEvent';
const KICK_GLOBAL_BADGE_IMAGE_URLS = {
  broadcaster: 'https://www.kickdatabase.com/kickBadges/broadcaster.svg',
  founder: 'https://www.kickdatabase.com/kickBadges/founder.svg',
  moderator: 'https://www.kickdatabase.com/kickBadges/moderator.svg',
  og: 'https://www.kickdatabase.com/kickBadges/og.svg',
  sidekick: 'https://www.kickdatabase.com/kickBadges/sidekick.svg',
  staff: 'https://www.kickdatabase.com/kickBadges/staff.svg',
  subscriber: 'https://www.kickdatabase.com/kickBadges/subscriber.svg',
  subgifter: 'https://www.kickdatabase.com/kickBadges/subgifter.svg',
  subgifter25: 'https://www.kickdatabase.com/kickBadges/subgifter25.svg',
  subgifter50: 'https://www.kickdatabase.com/kickBadges/subgifter50.svg',
  subgifter100: 'https://www.kickdatabase.com/kickBadges/subgifter100.svg',
  subgifter200: 'https://www.kickdatabase.com/kickBadges/subgifter200.svg',
  verified: 'https://www.kickdatabase.com/kickBadges/verified.svg',
  vip: 'https://www.kickdatabase.com/kickBadges/vip.svg',
};
const KICK_EMOTE_IMAGE_URL = 'https://files.kick.com/emotes';

const parseKickPusherEnvelope = (rawMessage) => {
  const envelope =
    typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;

  if (envelope.event === 'pusher:ping') {
    return { type: 'ping' };
  }

  if (envelope.event !== KICK_CHAT_MESSAGE_EVENT) {
    return undefined;
  }

  const data =
    typeof envelope.data === 'string' ? JSON.parse(envelope.data) : envelope.data;

  return {
    type: 'message',
    message: normalizeKickChatMessage(data, envelope),
  };
};

const normalizeKickChatMessage = (data, envelope) => {
  const sender = data.sender ?? data.user ?? {};
  const username = sender.username ?? sender.slug ?? sender.name ?? 'unknown';
  const rawContent = String(data.content ?? data.message ?? '').trim();
  const fragments = parseKickEmoteFragments(rawContent, normalizeKickEmotes(data));
  const text = fragments.map((fragment) => fragment.text).join('').trim();

  if (!text) {
    return undefined;
  }

  return normalizeChatMessage({
    id: String(data.id ?? `${data.chatroom_id ?? 'kick'}-${Date.now()}`),
    platform: 'kick',
    author: {
      id: String(sender.id ?? username),
      name: String(username),
      avatarUrl: sender.profile_pic ?? sender.profilePic,
      badges: normalizeKickBadges(data),
    },
    text,
    fragments,
    timestamp: normalizeKickTimestamp(data.created_at ?? data.createdAt),
    raw: {
      envelope,
      data,
    },
  });
};

const parseKickEmoteFragments = (content, emotes = []) => {
  const markupFragments = parseKickMarkupEmoteFragments(content);

  if (markupFragments) {
    return markupFragments;
  }

  if (emotes.length === 0) {
    return [{ type: 'text', text: content }];
  }

  return parseKickNamedEmoteFragments(content, emotes);
};

const parseKickMarkupEmoteFragments = (content) => {
  const pattern = /\[emote:([^:\]]+):([^\]]+)\]/gu;
  const fragments = [];
  let cursor = 0;
  let matched = false;

  for (const match of content.matchAll(pattern)) {
    const [token, firstValue, secondValue] = match;
    const id = /^\d+$/u.test(firstValue) ? firstValue : secondValue;
    const name = /^\d+$/u.test(firstValue) ? secondValue : firstValue;

    if (!/^\d+$/u.test(id)) {
      continue;
    }

    matched = true;

    if (match.index > cursor) {
      fragments.push({ type: 'text', text: content.slice(cursor, match.index) });
    }

    fragments.push({
      type: 'emote',
      id,
      text: normalizeKickEmoteName(name),
      imageUrl: createKickEmoteImageUrl(id),
    });
    cursor = match.index + token.length;
  }

  if (!matched) {
    return undefined;
  }

  if (cursor < content.length) {
    fragments.push({ type: 'text', text: content.slice(cursor) });
  }

  return fragments.filter((fragment) => fragment.text.length > 0);
};

const parseKickNamedEmoteFragments = (content, emotes) => {
  const emoteByToken = new Map(
    emotes
      .filter((emote) => emote.imageUrl && emote.text)
      .flatMap((emote) => [
        [emote.text, emote],
        [`:${emote.text}:`, emote],
      ]),
  );

  if (emoteByToken.size === 0) {
    return [{ type: 'text', text: content }];
  }

  const escapedTokens = [...emoteByToken.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  const pattern = new RegExp(`(${escapedTokens.join('|')})`, 'gu');
  const fragments = [];
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const token = match[0];
    const emote = emoteByToken.get(token);

    if (!emote) {
      continue;
    }

    if (match.index > cursor) {
      fragments.push({ type: 'text', text: content.slice(cursor, match.index) });
    }

    fragments.push({
      type: 'emote',
      id: emote.id,
      text: emote.text,
      imageUrl: emote.imageUrl,
    });
    cursor = match.index + token.length;
  }

  if (cursor < content.length) {
    fragments.push({ type: 'text', text: content.slice(cursor) });
  }

  return fragments.length > 0 ? fragments : [{ type: 'text', text: content }];
};

const normalizeKickEmotes = (data = {}) =>
  [
    ...normalizeEmoteCollection(data.emotes),
    ...normalizeEmoteCollection(data.message?.emotes),
    ...normalizeEmoteCollection(data.metadata?.emotes),
  ]
    .map(normalizeKickEmote)
    .filter(Boolean);

const normalizeEmoteCollection = (emotes) => {
  if (!emotes) {
    return [];
  }

  return Array.isArray(emotes) ? emotes : [emotes];
};

const normalizeKickEmote = (emote) => {
  if (!emote || typeof emote !== 'object') {
    return undefined;
  }

  const id = normalizeOptionalEmoteValue(
    emote.id ?? emote.emote_id ?? emote.emoteId ?? emote.uuid,
  );
  const text = normalizeKickEmoteName(
    emote.name ?? emote.text ?? emote.code ?? emote.slug,
  );
  const imageUrl = normalizeOptionalString(
    emote.imageUrl ?? emote.image_url ?? emote.url ?? emote.src ?? emote.image,
  ) ?? (id ? createKickEmoteImageUrl(id) : undefined);

  if (!text || !imageUrl) {
    return undefined;
  }

  return { id, text, imageUrl };
};

const normalizeKickEmoteName = (value) =>
  typeof value === 'string' ? value.trim().replace(/^:/u, '').replace(/:$/u, '') : '';

const normalizeOptionalEmoteValue = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }

  const normalizedValue = String(value).trim();

  return normalizedValue || undefined;
};

const createKickEmoteImageUrl = (id) =>
  `${KICK_EMOTE_IMAGE_URL}/${encodeURIComponent(id)}/fullsize`;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const normalizeKickBadges = (data = {}) => {
  const sender = data.sender ?? data.user ?? {};
  const rawBadges = [
    ...normalizeBadgeCollection(sender.badges),
    ...normalizeBadgeCollection(sender.identity?.badges),
    ...normalizeBadgeCollection(data.badges),
    ...normalizeBadgeCollection(data.identity?.badges),
    ...normalizeBadgeCollection(data.sender_badges),
  ];
  const badges = [
    ...rawBadges.map(normalizeKickBadge).filter(Boolean),
    ...createKickLevelBadges(data),
  ];

  if (badges.length > 0) {
    return dedupeBadges(badges);
  }

  return createKickRoleBadges(sender);
};

const normalizeBadgeCollection = (badges) => {
  if (!badges) {
    return [];
  }

  return Array.isArray(badges) ? badges : [badges];
};

const normalizeKickBadge = (badge) => {
  if (typeof badge === 'number') {
    return createKickLevelBadge(badge);
  }

  if (typeof badge === 'string') {
    if (/^\d+$/u.test(badge.trim())) {
      return createKickLevelBadge(badge);
    }

    return createKickBadge(badge);
  }

  if (!badge || typeof badge !== 'object') {
    return undefined;
  }

  const id = normalizeKickBadgeId(
    badge.id ?? badge.type ?? badge.name ?? badge.text ?? badge.slug,
  );
  const level = normalizeKickLevel(
    badge.level ?? badge.chatroom_level ?? badge.chatroomLevel ?? badge.value,
  );

  if (!id && level) {
    return createKickLevelBadge(level);
  }

  if (!id) {
    return undefined;
  }

  return {
    id,
    label: normalizeKickBadgeLabel(badge.label ?? badge.title ?? badge.name ?? badge.text ?? id),
    version: normalizeOptionalString(badge.version ?? badge.count ?? badge.months),
    imageUrl: normalizeOptionalString(
      badge.imageUrl ?? badge.image_url ?? badge.image ?? badge.iconUrl ?? badge.icon_url,
    ) ?? getKickBadgeImageUrl(id),
  };
};

const createKickLevelBadges = (data = {}) => {
  const sender = data.sender ?? data.user ?? {};
  const level = normalizeKickLevel(
    sender.level ??
      sender.chat_level ??
      sender.chatLevel ??
      sender.chatroom_level ??
      sender.chatroomLevel ??
      sender.identity?.level ??
      sender.identity?.chat_level ??
      sender.identity?.chatLevel ??
      sender.identity?.chatroom_level ??
      sender.identity?.chatroomLevel ??
      data.level ??
      data.sender_level ??
      data.senderLevel ??
      data.sender_chat_level ??
      data.senderChatLevel ??
      data.sender_chatroom_level ??
      data.senderChatroomLevel,
  );

  return level ? [createKickLevelBadge(level)] : [];
};

const createKickLevelBadge = (level) => {
  const normalizedLevel = normalizeKickLevel(level);

  if (!normalizedLevel) {
    return undefined;
  }

  return {
    id: `level-${normalizedLevel}`,
    label: normalizedLevel,
    version: normalizedLevel,
    imageUrl: undefined,
  };
};

const createKickRoleBadges = (sender) => {
  const badges = [];
  const role = normalizeKickBadgeId(sender.role);

  if (role && role !== 'user') {
    badges.push(createKickBadge(role));
  }

  if (sender.isSubscribed || sender.is_subscribed) {
    badges.push(createKickBadge('subscriber'));
  }

  if (sender.isVerified || sender.is_verified) {
    badges.push(createKickBadge('verified'));
  }

  return dedupeBadges(badges);
};

const createKickBadge = (id) => {
  const normalizedId = normalizeKickBadgeId(id);

  if (!normalizedId) {
    return undefined;
  }

  return {
    id: normalizedId,
    label: getKickBadgeLabel(normalizedId),
    version: undefined,
    imageUrl: getKickBadgeImageUrl(normalizedId),
  };
};

const dedupeBadges = (badges) => {
  const seen = new Set();
  const uniqueBadges = [];

  for (const badge of badges) {
    if (!badge || seen.has(badge.id)) {
      continue;
    }

    seen.add(badge.id);
    uniqueBadges.push(badge);
  }

  return uniqueBadges;
};

const normalizeKickBadgeId = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^kick[-_\s]*/u, '')
    .replace(/\s+/gu, '-')
    .replace(/_/gu, '-');
};

const normalizeKickLevel = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  const level = String(value).trim();

  return /^\d+$/u.test(level) ? level : '';
};

const normalizeKickBadgeLabel = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'Kick Badge';
  }

  return value.trim();
};

const normalizeOptionalString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const getKickBadgeLabel = (badgeId) => {
  const labels = {
    broadcaster: 'Broadcaster',
    founder: 'Founder',
    moderator: 'Mod',
    og: 'OG',
    staff: 'Staff',
    subscriber: 'Sub',
    verified: 'Verified',
    vip: 'VIP',
  };

  return labels[badgeId] ?? badgeId;
};

const getKickBadgeImageUrl = (badgeId) => KICK_GLOBAL_BADGE_IMAGE_URLS[badgeId];

const normalizeKickTimestamp = (value) => {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
};

module.exports = {
  KICK_CHAT_MESSAGE_EVENT,
  KICK_GLOBAL_BADGE_IMAGE_URLS,
  normalizeKickBadges,
  parseKickEmoteFragments,
  parseKickPusherEnvelope,
};
