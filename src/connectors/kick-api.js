const KICK_API_ORIGIN = 'https://api.kick.com';
const KICK_OAUTH_ORIGIN = 'https://id.kick.com';
const KICK_TOKEN_ENDPOINT = `${KICK_OAUTH_ORIGIN}/oauth/token`;
const KICK_USERS_ENDPOINT = `${KICK_API_ORIGIN}/public/v1/users`;
const KICK_CHANNELS_ENDPOINT = `${KICK_API_ORIGIN}/public/v1/channels`;
const KICK_CHAT_ENDPOINT = `${KICK_API_ORIGIN}/public/v1/chat`;
const KICK_TOKEN_INTROSPECT_ENDPOINT = `${KICK_API_ORIGIN}/public/v1/token/introspect`;

const exchangeKickAuthorizationCode = async ({
  code,
  clientId,
  clientSecret,
  oauthBrokerUrl,
  redirectUri,
  codeVerifier,
  fetchImpl = fetch,
} = {}) => {
  if (oauthBrokerUrl) {
    return exchangeKickTokenWithBroker({
      oauthBrokerUrl,
      clientId,
      code,
      codeVerifier,
      redirectUri,
      fetchImpl,
    });
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: normalizeRequiredString(clientId, 'Kick client ID'),
    client_secret: normalizeRequiredString(clientSecret, 'Kick client secret'),
    redirect_uri: normalizeRequiredString(redirectUri, 'Kick redirect URI'),
    code_verifier: normalizeRequiredString(codeVerifier, 'Kick code verifier'),
    code: normalizeRequiredString(code, 'Kick authorization code'),
  });

  const response = await fetchImpl(KICK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const responseBody = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createKickErrorMessage('Kick token exchange failed', response, responseBody));
  }

  return normalizeKickTokenResponse(responseBody);
};

const refreshKickAccessToken = async ({
  refreshToken,
  clientId,
  clientSecret,
  oauthBrokerUrl,
  fetchImpl = fetch,
} = {}) => {
  if (oauthBrokerUrl) {
    return refreshKickTokenWithBroker({
      oauthBrokerUrl,
      clientId,
      refreshToken,
      fetchImpl,
    });
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: normalizeRequiredString(clientId, 'Kick client ID'),
    client_secret: normalizeRequiredString(clientSecret, 'Kick client secret'),
    refresh_token: normalizeRequiredString(refreshToken, 'Kick refresh token'),
  });

  const response = await fetchImpl(KICK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const responseBody = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createKickErrorMessage('Kick token refresh failed', response, responseBody));
  }

  return normalizeKickTokenResponse(responseBody);
};

const exchangeKickTokenWithBroker = async ({
  oauthBrokerUrl,
  clientId,
  code,
  codeVerifier,
  redirectUri,
  fetchImpl,
}) => {
  const response = await fetchImpl(createBrokerEndpoint(oauthBrokerUrl, '/kick/token'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientId: normalizeRequiredString(clientId, 'Kick client ID'),
      code: normalizeRequiredString(code, 'Kick authorization code'),
      codeVerifier: normalizeRequiredString(codeVerifier, 'Kick code verifier'),
      redirectUri: normalizeRequiredString(redirectUri, 'Kick redirect URI'),
    }),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createKickErrorMessage('Kick broker token exchange failed', response, body));
  }

  return normalizeKickTokenResponse(body);
};

const refreshKickTokenWithBroker = async ({
  oauthBrokerUrl,
  clientId,
  refreshToken,
  fetchImpl,
}) => {
  const response = await fetchImpl(createBrokerEndpoint(oauthBrokerUrl, '/kick/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientId: normalizeRequiredString(clientId, 'Kick client ID'),
      refreshToken: normalizeRequiredString(refreshToken, 'Kick refresh token'),
    }),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createKickErrorMessage('Kick broker token refresh failed', response, body));
  }

  return normalizeKickTokenResponse(body);
};

const createBrokerEndpoint = (oauthBrokerUrl, pathname) => {
  const url = new URL(normalizeRequiredString(oauthBrokerUrl, 'Kick OAuth Broker URL'));

  url.pathname = pathname;
  url.search = '';
  url.hash = '';

  return url.toString();
};

const validateKickAccessToken = async ({ accessToken, fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(KICK_TOKEN_INTROSPECT_ENDPOINT, {
    method: 'POST',
    headers: createKickApiHeaders(accessToken),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createKickErrorMessage('Kick token validation failed', response, body));
  }

  const data = body?.data ?? {};

  if (data.active === false) {
    throw new Error('Kick token is not active.');
  }

  return {
    active: data.active !== false,
    clientId: normalizeOptionalString(data.client_id),
    tokenType: normalizeOptionalString(data.token_type),
    scopes: normalizeScopeList(data.scope),
    expiresAt: data.exp ? new Date(Number(data.exp) * 1000).toISOString() : '',
  };
};

const resolveKickCurrentUser = async ({ accessToken, fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(KICK_USERS_ENDPOINT, {
    headers: createKickApiHeaders(accessToken),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createKickErrorMessage('Kick user lookup failed', response, body));
  }

  const user = Array.isArray(body?.data) ? body.data[0] : body?.data;

  if (!user?.user_id && !user?.id) {
    throw new Error('Kick current user was not returned.');
  }

  const userId = String(user.user_id ?? user.id);
  const login = normalizeFirstString(
    [user.name, user.username, user.slug, user.display_name, user.displayName, userId],
    'Kick user name',
  );
  const displayName = normalizeFirstString(
    [user.display_name, user.displayName, user.name, user.username, user.slug, login],
    'Kick display name',
  );

  return {
    userId,
    login,
    displayName,
    profilePicture: normalizeOptionalString(user.profile_picture ?? user.profilePicture),
  };
};

const resolveKickChannelBySlug = async ({ channel, accessToken, fetchImpl = fetch } = {}) => {
  const normalizedChannel = normalizeKickChannelSlug(channel);
  const url = new URL(KICK_CHANNELS_ENDPOINT);

  url.searchParams.append('slug', normalizedChannel);

  const response = await fetchImpl(url.toString(), {
    headers: createKickApiHeaders(accessToken),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(createKickErrorMessage('Kick channel lookup failed', response, body));
  }

  const channelData = body?.data?.[0];

  if (!channelData?.broadcaster_user_id) {
    throw new Error(`Kick channel not found: ${normalizedChannel}.`);
  }

  return {
    broadcasterUserId: normalizePositiveInteger(
      channelData.broadcaster_user_id,
      'Kick broadcaster_user_id',
    ),
    slug: normalizeRequiredString(channelData.slug ?? normalizedChannel, 'Kick channel slug'),
  };
};

const sendKickChatMessage = async ({
  channel,
  accessToken,
  message,
  fetchImpl = fetch,
} = {}) => {
  const normalizedMessage = normalizeRequiredString(message, 'Kick message');
  const broadcaster = await resolveKickChannelBySlug({
    channel,
    accessToken,
    fetchImpl,
  });
  const response = await fetchImpl(KICK_CHAT_ENDPOINT, {
    method: 'POST',
    headers: createKickApiHeaders(accessToken),
    body: JSON.stringify({
      broadcaster_user_id: broadcaster.broadcasterUserId,
      content: normalizedMessage,
      type: 'user',
    }),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(createKickSendForbiddenMessage(body));
    }

    throw new Error(createKickErrorMessage('Kick send failed', response, body));
  }

  return {
    isSent: true,
    message: normalizeOptionalString(body?.message),
  };
};

const normalizeKickTokenResponse = (body = {}) => {
  const expiresIn = Number(body.expires_in || 0);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : '';

  return {
    accessToken: normalizeRequiredString(body.access_token, 'Kick access token'),
    refreshToken: normalizeOptionalString(body.refresh_token),
    tokenType: normalizeOptionalString(body.token_type),
    expiresIn,
    expiresAt,
    scopes: normalizeScopeList(body.scope),
  };
};

const createKickApiHeaders = (accessToken) => ({
  Authorization: `Bearer ${normalizeRequiredString(accessToken, 'Kick access token')}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

const parseJsonResponse = async (response) => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const createKickErrorMessage = (prefix, response, body) => {
  const detail = body?.message || body?.error || body?.error_description;

  return detail
    ? `${prefix} with status ${response.status}: ${detail}`
    : `${prefix} with status ${response.status}.`;
};

const createKickSendForbiddenMessage = (body) => {
  const detail = body?.message || body?.error || body?.error_description;
  const suffix = detail ? ` Kick returned: ${detail}` : '';

  return (
    'Kick send failed with status 403. The channel may require the sender to follow ' +
    'the channel, subscribe, or have permission to chat there.' +
    suffix
  );
};

const normalizeScopeList = (scope) => {
  if (Array.isArray(scope)) {
    return scope.map(String).filter(Boolean);
  }

  if (typeof scope !== 'string') {
    return [];
  }

  return scope.split(/\s+/).filter(Boolean);
};

const normalizeKickChannelSlug = (channel) =>
  normalizeRequiredString(channel, 'Kick channel')
    .replace(/^@/, '')
    .replace(/^https?:\/\/(?:www\.)?kick\.com\//i, '')
    .replace(/^kick\.com\//i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();

const normalizePositiveInteger = (value, fieldName) => {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer.`);
  }

  return number;
};

const normalizeRequiredString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

const normalizeFirstString = (values, fieldName) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  throw new TypeError(`${fieldName} must be a non-empty string.`);
};

const normalizeOptionalString = (value) =>
  typeof value === 'string' ? value.trim() : '';

module.exports = {
  KICK_CHAT_ENDPOINT,
  KICK_TOKEN_ENDPOINT,
  exchangeKickAuthorizationCode,
  refreshKickAccessToken,
  resolveKickChannelBySlug,
  resolveKickCurrentUser,
  sendKickChatMessage,
  validateKickAccessToken,
};
