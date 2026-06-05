const TWITCH_AUTH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_USERS_ENDPOINT = 'https://api.twitch.tv/helix/users';
const TWITCH_SEND_CHAT_MESSAGE_ENDPOINT = 'https://api.twitch.tv/helix/chat/messages';
const TWITCH_WRITE_SCOPE = 'user:write:chat';

const sendTwitchChatMessage = async ({
  channel,
  accessToken,
  message,
  fetchImpl = fetch,
} = {}) => {
  const normalizedMessage = normalizeRequiredString(message, 'Twitch message');
  const tokenInfo = await validateTwitchAccessToken({ accessToken, fetchImpl });

  if (!tokenInfo.scopes.includes(TWITCH_WRITE_SCOPE)) {
    throw new Error(`Twitch token is missing the ${TWITCH_WRITE_SCOPE} scope.`);
  }

  const broadcaster = await resolveTwitchUserByLogin({
    login: channel,
    accessToken,
    clientId: tokenInfo.clientId,
    fetchImpl,
  });
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
  const normalizedLogin = normalizeRequiredString(login, 'Twitch login').toLowerCase();
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

const createTwitchApiHeaders = (accessToken, clientId) => ({
  Authorization: `Bearer ${normalizeTwitchAccessToken(accessToken)}`,
  'Client-Id': normalizeRequiredString(clientId, 'Twitch client_id'),
  'Content-Type': 'application/json',
});

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

const normalizeRequiredString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

module.exports = {
  TWITCH_SEND_CHAT_MESSAGE_ENDPOINT,
  TWITCH_WRITE_SCOPE,
  resolveTwitchUserByLogin,
  sendTwitchChatMessage,
  validateTwitchAccessToken,
};
