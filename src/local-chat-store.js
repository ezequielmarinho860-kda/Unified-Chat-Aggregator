const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_CHAT_SOURCE = Object.freeze({
  sourceId: 'local:chat',
  platform: 'local',
  channelLabel: 'Local Chat',
});
const DEFAULT_LOCAL_CHAT_STATE = Object.freeze({
  bans: [],
  messages: [],
  moderators: [],
  sessions: [],
  timeouts: [],
  users: [],
});
const DEFAULT_MESSAGE_LIMIT = 500;

const createLocalChatStore = ({
  filePath,
  idFactory = crypto.randomUUID,
  messageLimit = DEFAULT_MESSAGE_LIMIT,
  now = () => new Date(),
} = {}) => {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('Local chat store requires a file path.');
  }

  const exists = () => fs.existsSync(filePath);

  const load = () => {
    try {
      if (!exists()) {
        return normalizeState(DEFAULT_LOCAL_CHAT_STATE);
      }

      return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
      return normalizeState(DEFAULT_LOCAL_CHAT_STATE);
    }
  };

  const save = (state) => {
    const normalized = normalizeState(state);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  };

  const update = (mutator) => {
    const state = load();
    const result = mutator(state);

    return { state: save(state), result };
  };

  const registerUser = ({ email, nick }) =>
    update((state) => {
      const normalizedEmail = normalizeEmail(email);
      const normalizedNick = normalizeNick(nick);
      const existingUser = state.users.find((user) => user.emailKey === normalizedEmail);

      if (state.users.some((user) => user.nickKey === normalizedNick && user.emailKey !== normalizedEmail)) {
        throw new Error('Local chat nick is already taken.');
      }

      if (existingUser) {
        existingUser.nick = requireNick(nick);
        existingUser.nickKey = normalizedNick;
        existingUser.role = getConfiguredRole(state, existingUser);
        existingUser.updatedAt = nowIso(now);
        return existingUser;
      }

      const user = {
        id: idFactory(),
        email: requireEmail(email),
        emailKey: normalizedEmail,
        nick: requireNick(nick),
        nickKey: normalizedNick,
        role: 'user',
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      };

      user.role = getConfiguredRole(state, user);
      state.users.push(user);
      return user;
    }).result;

  const createSession = ({ email }) =>
    update((state) => {
      const user = findUserByEmail(state, email);

      if (!user) {
        throw new Error('Local chat user was not found.');
      }

      const session = {
        token: idFactory(),
        userId: user.id,
        createdAt: nowIso(now),
      };

      state.sessions.push(session);
      return { session, user };
    }).result;

  const getSessionUser = (token) => {
    const state = load();
    const session = state.sessions.find((entry) => entry.token === token);

    return session ? state.users.find((user) => user.id === session.userId) : undefined;
  };

  const getUserByEmail = (email) => {
    const state = load();

    return findUserByEmail(state, email);
  };

  const getUserByNick = (nick) => {
    const state = load();

    return findUserByNick(state, nick);
  };

  const addModerator = ({ email, nick }) =>
    update((state) => {
      const moderator = normalizeModerator({ email, nick, createdAt: nowIso(now) });

      if (!state.moderators.some((entry) => sameModerator(entry, moderator))) {
        state.moderators.push(moderator);
      }

      for (const user of state.users) {
        if (matchesIdentity(user, moderator)) {
          user.role = 'moderator';
          user.updatedAt = nowIso(now);
        }
      }

      return moderator;
    }).result;

  const removeModerator = ({ email, nick }) =>
    update((state) => {
      const moderator = normalizeModerator({ email, nick });
      const beforeCount = state.moderators.length;

      state.moderators = state.moderators.filter((entry) => !sameModerator(entry, moderator));
      for (const user of state.users) {
        user.role = getConfiguredRole(state, user);
        user.updatedAt = nowIso(now);
      }

      return beforeCount - state.moderators.length;
    }).result;

  const banUser = ({ email, nick, reason = '', moderatorId = '' }) =>
    update((state) => {
      const ban = normalizeRestriction({
        email,
        nick,
        reason,
        moderatorId,
        createdAt: nowIso(now),
      });

      state.bans.push(ban);
      return ban;
    }).result;

  const unbanUser = ({ email, nick }) =>
    update((state) => {
      const restriction = normalizeRestriction({ email, nick });
      const beforeCount = state.bans.length;

      state.bans = state.bans.filter((ban) => !sameRestrictionTarget(ban, restriction));
      return beforeCount - state.bans.length;
    }).result;

  const timeoutUser = ({ email, nick, durationSeconds, reason = '', moderatorId = '' }) =>
    update((state) => {
      const duration = normalizePositiveInteger(durationSeconds, 'timeout duration');
      const timeout = normalizeRestriction({
        email,
        nick,
        reason,
        moderatorId,
        createdAt: nowIso(now),
        expiresAt: new Date(now().valueOf() + duration * 1000).toISOString(),
      });

      state.timeouts.push(timeout);
      return timeout;
    }).result;

  const clearTimeout = ({ email, nick }) =>
    update((state) => {
      const restriction = normalizeRestriction({ email, nick });
      const beforeCount = state.timeouts.length;

      state.timeouts = state.timeouts.filter((timeout) => !sameRestrictionTarget(timeout, restriction));
      return beforeCount - state.timeouts.length;
    }).result;

  const createMessage = ({ token, text }) =>
    update((state) => {
      const user = requireSessionUser(state, token);
      const restriction = getActiveRestriction(state, user, now());

      if (restriction) {
        throw new Error(restriction.type === 'ban' ? 'Local chat user is banned.' : 'Local chat user is timed out.');
      }

      const messageText = normalizeMessageText(text);
      const message = {
        id: idFactory(),
        platform: 'local',
        source: LOCAL_CHAT_SOURCE,
        author: {
          id: user.id,
          name: user.nick,
          badges: createAuthorBadges(user),
        },
        text: messageText,
        fragments: createMentionFragments(messageText),
        timestamp: nowIso(now),
      };

      state.messages.push(message);
      state.messages = state.messages.slice(-messageLimit);
      return message;
    }).result;

  return {
    addModerator,
    banUser,
    createMessage,
    createSession,
    exists,
    getSessionUser,
    getUserByEmail,
    getUserByNick,
    load,
    registerUser,
    removeModerator,
    save,
    timeoutUser,
    unbanUser,
    clearTimeout,
  };
};

const normalizeState = (state = {}) => ({
  bans: Array.isArray(state.bans) ? state.bans.map(normalizeRestriction) : [],
  messages: Array.isArray(state.messages) ? state.messages : [],
  moderators: Array.isArray(state.moderators) ? state.moderators.map(normalizeModerator) : [],
  sessions: Array.isArray(state.sessions) ? state.sessions.map(normalizeSession) : [],
  timeouts: Array.isArray(state.timeouts) ? state.timeouts.map(normalizeRestriction) : [],
  users: Array.isArray(state.users) ? state.users.map(normalizeUser) : [],
});

const normalizeUser = (user = {}) => ({
  id: requireString(user.id, 'user id'),
  email: requireEmail(user.email),
  emailKey: normalizeEmail(user.emailKey || user.email),
  nick: requireNick(user.nick),
  nickKey: normalizeNick(user.nickKey || user.nick),
  role: user.role === 'moderator' || user.role === 'host' ? user.role : 'user',
  createdAt: optionalString(user.createdAt) || new Date(0).toISOString(),
  updatedAt: optionalString(user.updatedAt) || new Date(0).toISOString(),
});

const createMentionFragments = (text) => {
  const fragments = [];
  const mentionPattern = /(^|[^\w])(@[A-Za-z0-9_]{2,24})\b/g;
  let cursor = 0;
  let match;

  while ((match = mentionPattern.exec(text)) !== null) {
    const mentionStart = match.index + match[1].length;

    if (mentionStart > cursor) {
      fragments.push({ type: 'text', text: text.slice(cursor, mentionStart) });
    }

    fragments.push({ type: 'mention', text: match[2] });
    cursor = mentionStart + match[2].length;
  }

  if (cursor < text.length) {
    fragments.push({ type: 'text', text: text.slice(cursor) });
  }

  return fragments.length > 0 ? fragments : [{ type: 'text', text }];
};

const normalizeSession = (session = {}) => ({
  token: requireString(session.token, 'session token'),
  userId: requireString(session.userId, 'session user id'),
  createdAt: optionalString(session.createdAt) || new Date(0).toISOString(),
});

const normalizeModerator = ({ email, nick, createdAt } = {}) => {
  const hasEmail = optionalString(email);
  const hasNick = optionalString(nick);

  if (!hasEmail && !hasNick) {
    throw new TypeError('Local chat moderator requires email or nick.');
  }

  return {
    email: hasEmail ? requireEmail(email) : undefined,
    emailKey: hasEmail ? normalizeEmail(email) : undefined,
    nick: hasNick ? requireNick(nick) : undefined,
    nickKey: hasNick ? normalizeNick(nick) : undefined,
    createdAt: optionalString(createdAt) || new Date(0).toISOString(),
  };
};

const normalizeRestriction = ({ email, nick, reason = '', moderatorId = '', createdAt, expiresAt } = {}) => {
  const moderator = normalizeModerator({ email, nick, createdAt });

  return {
    ...moderator,
    reason: optionalString(reason) || '',
    moderatorId: optionalString(moderatorId) || '',
    expiresAt: optionalString(expiresAt),
  };
};

const requireSessionUser = (state, token) => {
  const session = state.sessions.find((entry) => entry.token === token);
  const user = session ? state.users.find((entry) => entry.id === session.userId) : undefined;

  if (!user) {
    throw new Error('Local chat session is invalid.');
  }

  return user;
};

const getActiveRestriction = (state, user, currentDate) => {
  if (state.bans.some((ban) => matchesIdentity(user, ban))) {
    return { type: 'ban' };
  }

  const activeTimeout = state.timeouts.find((timeout) =>
    matchesIdentity(user, timeout) && new Date(timeout.expiresAt).valueOf() > currentDate.valueOf());

  return activeTimeout ? { type: 'timeout' } : undefined;
};

const findUserByEmail = (state, email) =>
  state.users.find((user) => user.emailKey === normalizeEmail(email));

const findUserByNick = (state, nick) =>
  state.users.find((user) => user.nickKey === normalizeNick(nick));

const getConfiguredRole = (state, user) => {
  if (user.role === 'host') {
    return 'host';
  }

  return state.moderators.some((moderator) => matchesIdentity(user, moderator))
    ? 'moderator'
    : 'user';
};

const matchesIdentity = (user, identity) =>
  Boolean(
    (identity.emailKey && user.emailKey === identity.emailKey) ||
    (identity.nickKey && user.nickKey === identity.nickKey),
  );

const sameModerator = (left, right) =>
  left.emailKey === right.emailKey && left.nickKey === right.nickKey;

const sameRestrictionTarget = (left, right) =>
  Boolean(
    (right.emailKey && left.emailKey === right.emailKey) ||
    (right.nickKey && left.nickKey === right.nickKey),
  );

const createAuthorBadges = (user) =>
  user.role === 'moderator' || user.role === 'host'
    ? [{ id: user.role, label: user.role === 'host' ? 'Host' : 'Mod' }]
    : [];

const normalizeMessageText = (text) => {
  const normalized = requireString(text?.trim(), 'message text');

  if (normalized.length > 500) {
    throw new TypeError('Local chat message text must be 500 characters or less.');
  }

  return normalized;
};

const normalizeEmail = (email) => requireEmail(email).toLowerCase();

const normalizeNick = (nick) => requireNick(nick).toLowerCase();

const requireEmail = (email) => {
  const normalized = requireString(email?.trim(), 'email');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new TypeError('Local chat email must be valid.');
  }

  return normalized;
};

const requireNick = (nick) => {
  const normalized = requireString(nick?.trim(), 'nick');

  if (!/^[a-z0-9_]{3,24}$/i.test(normalized)) {
    throw new TypeError('Local chat nick must use 3-24 letters, numbers, or underscores.');
  }

  return normalized;
};

const normalizePositiveInteger = (value, label) => {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`Local chat ${label} must be a positive integer.`);
  }

  return number;
};

const nowIso = (now) => now().toISOString();

const requireString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Local chat ${label} is required.`);
  }

  return value;
};

const optionalString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

module.exports = {
  DEFAULT_LOCAL_CHAT_STATE,
  LOCAL_CHAT_SOURCE,
  createLocalChatStore,
};
