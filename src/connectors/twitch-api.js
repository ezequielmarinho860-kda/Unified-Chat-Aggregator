const TWITCH_AUTH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_USERS_ENDPOINT = 'https://api.twitch.tv/helix/users';
const TWITCH_SEND_CHAT_MESSAGE_ENDPOINT = 'https://api.twitch.tv/helix/chat/messages';
const TWITCH_GLOBAL_CHAT_BADGES_ENDPOINT = 'https://api.twitch.tv/helix/chat/badges/global';
const TWITCH_CHANNEL_CHAT_BADGES_ENDPOINT = 'https://api.twitch.tv/helix/chat/badges';
const TWITCH_SEND_ANNOUNCEMENT_ENDPOINT =
  'https://api.twitch.tv/helix/chat/announcements';
const TWITCH_BANS_ENDPOINT = 'https://api.twitch.tv/helix/moderation/bans';
const TWITCH_CHAT_MODERATION_ENDPOINT = 'https://api.twitch.tv/helix/moderation/chat';
const TWITCH_MODERATORS_ENDPOINT = 'https://api.twitch.tv/helix/moderation/moderators';
const TWITCH_WRITE_SCOPE = 'user:write:chat';
const TWITCH_ANNOUNCEMENT_SCOPE = 'moderator:manage:announcements';
const TWITCH_BAN_SCOPE = 'moderator:manage:banned_users';
const TWITCH_CHAT_MODERATION_SCOPE = 'moderator:manage:chat_messages';
const TWITCH_MANAGE_MODERATORS_SCOPE = 'channel:manage:moderators';
const ANNOUNCEMENT_COLORS = new Set(['blue', 'green', 'orange', 'purple', 'primary']);

const sendTwitchChatMessage = async ({
  channel,
  accessToken,
  message,
  fetchImpl = fetch,
} = {}) => {
  const normalizedMessage = normalizeRequiredString(message, 'Twitch message');
  const tokenInfo = await validateTwitchAccessToken({ accessToken, fetchImpl });
  const isCommand = normalizedMessage.startsWith('/');

  if (!isCommand) {
    requireTwitchScope(tokenInfo, TWITCH_WRITE_SCOPE);
  }

  const broadcaster = await resolveTwitchUserByLogin({
    login: channel,
    accessToken,
    clientId: tokenInfo.clientId,
    fetchImpl,
  });

  if (isCommand) {
    return executeTwitchChatCommand({
      commandInput: normalizedMessage,
      accessToken,
      broadcasterId: broadcaster.id,
      tokenInfo,
      fetchImpl,
    });
  }

  const response = await fetchImpl(TWITCH_SEND_CHAT_MESSAGE_ENDPOINT, {
    method: 'POST',
    headers: createTwitchApiHeaders(accessToken, tokenInfo.clientId),
    body: JSON.stringify({
      broadcaster_id: broadcaster.id,
      sender_id: tokenInfo.userId,
      message: normalizedMessage,
    }),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createTwitchErrorMessage('Twitch send failed', response, body));
  }

  const result = body?.data?.[0];

  if (!result?.is_sent) {
    const dropMessage = result?.drop_reason?.message || 'Twitch rejected the message.';
    throw new Error(dropMessage);
  }

  return {
    messageId: normalizeRequiredString(result.message_id, 'Twitch message_id'),
    isSent: true,
  };
};

const executeTwitchChatCommand = async ({
  commandInput,
  accessToken,
  broadcasterId,
  tokenInfo,
  fetchImpl = fetch,
}) => {
  const command = parseTwitchChatCommand(commandInput);
  const moderatorId = tokenInfo.userId;

  if (command.type === 'announce') {
    requireTwitchScope(tokenInfo, TWITCH_ANNOUNCEMENT_SCOPE);
    await sendTwitchAnnouncement({
      accessToken,
      clientId: tokenInfo.clientId,
      broadcasterId,
      moderatorId,
      message: command.message,
      color: command.color,
      fetchImpl,
    });
    return { command: command.type, isSent: true };
  }

  if (command.type === 'clear') {
    requireTwitchScope(tokenInfo, TWITCH_CHAT_MODERATION_SCOPE);
    await clearTwitchChat({
      accessToken,
      clientId: tokenInfo.clientId,
      broadcasterId,
      moderatorId,
      fetchImpl,
    });
    return { command: command.type, isSent: true };
  }

  if (command.type === 'ban' || command.type === 'timeout') {
    requireTwitchScope(tokenInfo, TWITCH_BAN_SCOPE);
    const user = await resolveTwitchUserByLogin({
      login: command.username,
      accessToken,
      clientId: tokenInfo.clientId,
      fetchImpl,
    });
    await banTwitchUser({
      accessToken,
      clientId: tokenInfo.clientId,
      broadcasterId,
      moderatorId,
      userId: user.id,
      duration: command.duration,
      reason: command.reason,
      fetchImpl,
    });
    return { command: command.type, targetUserId: user.id, isSent: true };
  }

  if (command.type === 'unban') {
    requireTwitchScope(tokenInfo, TWITCH_BAN_SCOPE);
    const user = await resolveTwitchUserByLogin({
      login: command.username,
      accessToken,
      clientId: tokenInfo.clientId,
      fetchImpl,
    });
    await unbanTwitchUser({
      accessToken,
      clientId: tokenInfo.clientId,
      broadcasterId,
      moderatorId,
      userId: user.id,
      fetchImpl,
    });
    return { command: command.type, targetUserId: user.id, isSent: true };
  }

  if (command.type === 'mod' || command.type === 'unmod') {
    requireTwitchScope(tokenInfo, TWITCH_MANAGE_MODERATORS_SCOPE);
    const user = await resolveTwitchUserByLogin({
      login: command.username,
      accessToken,
      clientId: tokenInfo.clientId,
      fetchImpl,
    });
    await updateTwitchModerator({
      accessToken,
      clientId: tokenInfo.clientId,
      broadcasterId,
      userId: user.id,
      action: command.type,
      fetchImpl,
    });
    return { command: command.type, targetUserId: user.id, isSent: true };
  }

  throw new Error(`Unsupported Twitch command: /${command.type}.`);
};

const parseTwitchChatCommand = (input) => {
  const normalizedInput = normalizeRequiredString(input, 'Twitch command');
  const [rawCommand = '', ...args] = normalizedInput.slice(1).split(/\s+/);
  const type = rawCommand.toLowerCase();

  if (type === 'clear') {
    return { type };
  }

  if (type === 'announce') {
    const [maybeColor, ...messageParts] = args;
    const color = ANNOUNCEMENT_COLORS.has(maybeColor) ? maybeColor : 'primary';
    const message = ANNOUNCEMENT_COLORS.has(maybeColor)
      ? messageParts.join(' ')
      : args.join(' ');

    return {
      type,
      color,
      message: normalizeRequiredString(message, 'Twitch announcement message'),
    };
  }

  if (['ban', 'timeout', 'unban', 'mod', 'unmod'].includes(type)) {
    const [username, ...rest] = args;
    const cleanUsername = normalizeTwitchLogin(username);

    if (type === 'timeout') {
      const [duration, ...reasonParts] = rest;
      const normalizedDuration = Number(duration);

      if (!Number.isInteger(normalizedDuration) || normalizedDuration <= 0) {
        throw new TypeError('Twitch timeout duration must be a positive integer.');
      }

      return {
        type,
        username: cleanUsername,
        duration: normalizedDuration,
        reason: reasonParts.join(' ').trim(),
      };
    }

    return {
      type,
      username: cleanUsername,
      reason: rest.join(' ').trim(),
    };
  }

  return { type };
};

const sendTwitchAnnouncement = async ({
  accessToken,
  clientId,
  broadcasterId,
  moderatorId,
  message,
  color,
  fetchImpl,
}) => {
  const url = new URL(TWITCH_SEND_ANNOUNCEMENT_ENDPOINT);

  url.searchParams.set('broadcaster_id', broadcasterId);
  url.searchParams.set('moderator_id', moderatorId);

  const response = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: createTwitchApiHeaders(accessToken, clientId),
    body: JSON.stringify({ message, color }),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createTwitchErrorMessage('Twitch announcement failed', response, body));
  }
};

const clearTwitchChat = async ({
  accessToken,
  clientId,
  broadcasterId,
  moderatorId,
  fetchImpl,
}) => {
  const url = new URL(TWITCH_CHAT_MODERATION_ENDPOINT);

  url.searchParams.set('broadcaster_id', broadcasterId);
  url.searchParams.set('moderator_id', moderatorId);

  await sendTwitchNoBodyRequest({
    url,
    method: 'DELETE',
    accessToken,
    clientId,
    errorPrefix: 'Twitch clear chat failed',
    fetchImpl,
  });
};

const banTwitchUser = async ({
  accessToken,
  clientId,
  broadcasterId,
  moderatorId,
  userId,
  duration,
  reason,
  fetchImpl,
}) => {
  const url = new URL(TWITCH_BANS_ENDPOINT);

  url.searchParams.set('broadcaster_id', broadcasterId);
  url.searchParams.set('moderator_id', moderatorId);

  const data = { user_id: userId };

  if (duration) {
    data.duration = duration;
  }

  if (reason) {
    data.reason = reason;
  }

  const response = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: createTwitchApiHeaders(accessToken, clientId),
    body: JSON.stringify({ data }),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createTwitchErrorMessage('Twitch ban command failed', response, body));
  }
};

const unbanTwitchUser = async ({
  accessToken,
  clientId,
  broadcasterId,
  moderatorId,
  userId,
  fetchImpl,
}) => {
  const url = new URL(TWITCH_BANS_ENDPOINT);

  url.searchParams.set('broadcaster_id', broadcasterId);
  url.searchParams.set('moderator_id', moderatorId);
  url.searchParams.set('user_id', userId);

  await sendTwitchNoBodyRequest({
    url,
    method: 'DELETE',
    accessToken,
    clientId,
    errorPrefix: 'Twitch unban command failed',
    fetchImpl,
  });
};

const updateTwitchModerator = async ({
  accessToken,
  clientId,
  broadcasterId,
  userId,
  action,
  fetchImpl,
}) => {
  const url = new URL(TWITCH_MODERATORS_ENDPOINT);

  url.searchParams.set('broadcaster_id', broadcasterId);
  url.searchParams.set('user_id', userId);

  await sendTwitchNoBodyRequest({
    url,
    method: action === 'mod' ? 'POST' : 'DELETE',
    accessToken,
    clientId,
    errorPrefix:
      action === 'mod' ? 'Twitch mod command failed' : 'Twitch unmod command failed',
    fetchImpl,
  });
};

const sendTwitchNoBodyRequest = async ({
  url,
  method,
  accessToken,
  clientId,
  errorPrefix,
  fetchImpl,
}) => {
  const response = await fetchImpl(url.toString(), {
    method,
    headers: createTwitchApiHeaders(accessToken, clientId),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createTwitchErrorMessage(errorPrefix, response, body));
  }
};

const validateTwitchAccessToken = async ({ accessToken, fetchImpl = fetch } = {}) => {
  const normalizedToken = normalizeTwitchAccessToken(accessToken);
  const response = await fetchImpl(TWITCH_AUTH_VALIDATE_URL, {
    headers: {
      Authorization: `OAuth ${normalizedToken}`,
    },
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createTwitchErrorMessage('Twitch token validation failed', response, body));
  }

  return {
    clientId: normalizeRequiredString(body.client_id, 'Twitch client_id'),
    userId: normalizeRequiredString(body.user_id, 'Twitch user_id'),
    login: normalizeRequiredString(body.login, 'Twitch login'),
    scopes: Array.isArray(body.scopes) ? body.scopes : [],
  };
};

const resolveTwitchUserByLogin = async ({
  login,
  accessToken,
  clientId,
  fetchImpl = fetch,
} = {}) => {
  const normalizedLogin = normalizeTwitchLogin(login);
  const url = new URL(TWITCH_USERS_ENDPOINT);

  url.searchParams.set('login', normalizedLogin);

  const response = await fetchImpl(url.toString(), {
    headers: createTwitchApiHeaders(accessToken, clientId),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createTwitchErrorMessage('Twitch user lookup failed', response, body));
  }

  const user = body?.data?.[0];

  if (!user?.id) {
    throw new Error(`Twitch user not found: ${normalizedLogin}.`);
  }

  return {
    id: String(user.id),
    login: String(user.login ?? normalizedLogin),
    displayName: String(user.display_name ?? user.login ?? normalizedLogin),
  };
};

const fetchTwitchChatBadgeCatalog = async ({
  channel,
  accessToken,
  fetchImpl = fetch,
} = {}) => {
  const tokenInfo = await validateTwitchAccessToken({ accessToken, fetchImpl });
  const broadcaster = await resolveTwitchUserByLogin({
    login: channel,
    accessToken,
    clientId: tokenInfo.clientId,
    fetchImpl,
  });
  const channelBadgesUrl = new URL(TWITCH_CHANNEL_CHAT_BADGES_ENDPOINT);

  channelBadgesUrl.searchParams.set('broadcaster_id', broadcaster.id);

  const [globalBadges, channelBadges] = await Promise.all([
    fetchTwitchBadgeSets({
      url: TWITCH_GLOBAL_CHAT_BADGES_ENDPOINT,
      accessToken,
      clientId: tokenInfo.clientId,
      errorPrefix: 'Twitch global badge lookup failed',
      fetchImpl,
    }),
    fetchTwitchBadgeSets({
      url: channelBadgesUrl.toString(),
      accessToken,
      clientId: tokenInfo.clientId,
      errorPrefix: 'Twitch channel badge lookup failed',
      fetchImpl,
    }),
  ]);

  return createTwitchBadgeCatalog([...globalBadges, ...channelBadges]);
};

const fetchTwitchBadgeSets = async ({
  url,
  accessToken,
  clientId,
  errorPrefix,
  fetchImpl,
}) => {
  const response = await fetchImpl(url, {
    headers: createTwitchApiHeaders(accessToken, clientId),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createTwitchErrorMessage(errorPrefix, response, body));
  }

  return Array.isArray(body?.data) ? body.data : [];
};

const createTwitchBadgeCatalog = (badgeSets) => {
  const catalog = {};

  for (const badgeSet of badgeSets) {
    const setId = String(badgeSet.set_id ?? '');

    if (!setId || !Array.isArray(badgeSet.versions)) {
      continue;
    }

    catalog[setId] ??= {};

    for (const version of badgeSet.versions) {
      const versionId = String(version.id ?? '');

      if (!versionId) {
        continue;
      }

      catalog[setId][versionId] = {
        label: String(version.title || version.description || setId),
        imageUrl: String(
          version.image_url_2x || version.image_url_1x || version.image_url_4x || '',
        ),
      };
    }
  }

  return catalog;
};

const createTwitchApiHeaders = (accessToken, clientId) => ({
  Authorization: `Bearer ${normalizeTwitchAccessToken(accessToken)}`,
  'Client-Id': normalizeRequiredString(clientId, 'Twitch client_id'),
  'Content-Type': 'application/json',
});

const requireTwitchScope = (tokenInfo, scope) => {
  if (!tokenInfo.scopes.includes(scope)) {
    throw new Error(`Twitch token is missing the ${scope} scope.`);
  }
};

const parseJsonResponse = async (response) => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const createTwitchErrorMessage = (prefix, response, body) => {
  const detail = body?.message || body?.error;

  return detail
    ? `${prefix} with status ${response.status}: ${detail}`
    : `${prefix} with status ${response.status}.`;
};

const normalizeTwitchAccessToken = (accessToken) => {
  const token = normalizeRequiredString(accessToken, 'Twitch access token');

  return token.replace(/^oauth:/i, '');
};

const normalizeTwitchLogin = (login) =>
  normalizeRequiredString(login, 'Twitch login').replace(/^@/, '').toLowerCase();

const normalizeRequiredString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

module.exports = {
  TWITCH_ANNOUNCEMENT_SCOPE,
  TWITCH_BAN_SCOPE,
  TWITCH_CHAT_MODERATION_SCOPE,
  TWITCH_CHANNEL_CHAT_BADGES_ENDPOINT,
  TWITCH_GLOBAL_CHAT_BADGES_ENDPOINT,
  TWITCH_MANAGE_MODERATORS_SCOPE,
  TWITCH_SEND_CHAT_MESSAGE_ENDPOINT,
  TWITCH_WRITE_SCOPE,
  createTwitchBadgeCatalog,
  executeTwitchChatCommand,
  fetchTwitchChatBadgeCatalog,
  parseTwitchChatCommand,
  resolveTwitchUserByLogin,
  sendTwitchChatMessage,
  validateTwitchAccessToken,
};
