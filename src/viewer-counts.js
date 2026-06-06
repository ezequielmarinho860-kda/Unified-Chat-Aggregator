const { validateTwitchAccessToken } = require('./connectors/twitch-api');
const { resolveKickChannelBySlug } = require('./connectors/kick-api');
const { normalizeKickChannelName } = require('./connectors/kick-resolver');

const TWITCH_STREAMS_ENDPOINT = 'https://api.twitch.tv/helix/streams';
const KICK_LIVESTREAMS_ENDPOINT = 'https://api.kick.com/public/v1/livestreams';
const TWITCH_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const twitchTokenValidationCache = new Map();
const kickBroadcasterCache = new Map();

const fetchTwitchViewerCount = async ({
  channel,
  accessToken,
  fetchImpl = fetch,
  now = Date.now,
} = {}) => {
  if (!accessToken) {
    throw new Error('Connect a Twitch account to load viewers.');
  }

  const normalizedAccessToken = accessToken.replace(/^oauth:/i, '');
  const tokenInfo = await getCachedTwitchTokenInfo({
    accessToken: normalizedAccessToken,
    fetchImpl,
    now,
  });
  const url = new URL(TWITCH_STREAMS_ENDPOINT);

  url.searchParams.set('user_login', normalizeRequiredString(channel, 'Twitch channel'));

  const response = await fetchImpl(url.toString(), {
    headers: {
      Authorization: `Bearer ${normalizedAccessToken}`,
      'Client-Id': tokenInfo.clientId,
    },
  });
  const body = await parseJsonResponse(response);
  const rateLimit = readTwitchRateLimit(response);

  if (!response.ok) {
    if (response.status === 401) {
      twitchTokenValidationCache.delete(normalizedAccessToken);
    }

    const error = new Error(`Twitch viewer lookup failed with status ${response.status}.`);

    error.rateLimit = rateLimit;
    throw error;
  }

  return {
    count: normalizeViewerCount(body?.data?.[0]?.viewer_count) ?? 0,
    rateLimit,
  };
};

const getCachedTwitchTokenInfo = async ({ accessToken, fetchImpl, now }) => {
  const cached = twitchTokenValidationCache.get(accessToken);
  const currentTime = now();

  if (cached?.expiresAt > currentTime) {
    return cached.tokenInfo;
  }

  const tokenInfo = await validateTwitchAccessToken({ accessToken, fetchImpl });

  twitchTokenValidationCache.clear();
  twitchTokenValidationCache.set(accessToken, {
    tokenInfo,
    expiresAt: currentTime + TWITCH_TOKEN_CACHE_TTL_MS,
  });
  return tokenInfo;
};

const clearTwitchTokenValidationCache = () => {
  twitchTokenValidationCache.clear();
};

const fetchKickViewerCount = async ({ channel, accessToken, fetchImpl = fetch } = {}) => {
  if (!accessToken) {
    throw new Error('Connect a Kick account to load viewers.');
  }

  const slug = normalizeKickChannelName(channel);
  let broadcasterUserId = kickBroadcasterCache.get(slug);

  if (!broadcasterUserId) {
    const broadcaster = await resolveKickChannelBySlug({ channel: slug, accessToken, fetchImpl });

    broadcasterUserId = broadcaster.broadcasterUserId;
    kickBroadcasterCache.set(slug, broadcasterUserId);
  }

  const url = new URL(KICK_LIVESTREAMS_ENDPOINT);

  url.searchParams.set('broadcaster_user_id', broadcasterUserId);

  const response = await fetchImpl(url.toString(), {
    headers: createKickApiHeaders(accessToken),
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status === 401) {
      kickBroadcasterCache.delete(slug);
    }

    throw createStatusError(`Kick viewer lookup failed with status ${response.status}.`, response);
  }

  return normalizeViewerCount(body?.data?.[0]?.viewer_count) ?? 0;
};

const createRefreshingKickViewerFetcher = ({
  refreshAccessToken,
  onAuthUpdate = async () => {},
  fetchViewerCount = fetchKickViewerCount,
} = {}) => {
  if (typeof refreshAccessToken !== 'function') {
    throw new TypeError('refreshAccessToken must be a function.');
  }

  return async (config = {}) => {
    try {
      return await fetchViewerCount(config);
    } catch (error) {
      if (!isUnauthorizedError(error) || !config.refreshToken) {
        throw error;
      }

      const token = await refreshAccessToken(config);
      const authPatch = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken || config.refreshToken,
        expiresAt: token.expiresAt,
      };

      await onAuthUpdate(authPatch);
      return fetchViewerCount({ ...config, ...authPatch });
    }
  };
};

const clearKickBroadcasterCache = () => {
  kickBroadcasterCache.clear();
};

const parseViewerCountText = (value) => {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = text.match(
    /(\d[\d.,]*)\s*(k|m|b|mil|mi|milh(?:ao|oes))?\s+(?:viewers?|watching|assistindo|espectadores?)/i,
  );

  if (!match) {
    return undefined;
  }

  const suffixes = { mil: 'k', mi: 'm', milhao: 'm', milhoes: 'm' };

  return parseAbbreviatedCount(`${match[1]}${suffixes[match[2]?.toLowerCase()] ?? match[2] ?? ''}`);
};

const parseAbbreviatedCount = (value) => {
  const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
  const match = normalized.match(/^([\d.,]+)([kmb]?)$/);

  if (!match) {
    return undefined;
  }

  const suffixMultiplier = { '': 1, k: 1_000, m: 1_000_000, b: 1_000_000_000 };
  const numericPart = normalizeNumericPart(match[1], Boolean(match[2]));
  const count = Number(numericPart) * suffixMultiplier[match[2]];

  return normalizeViewerCount(Math.round(count));
};

const normalizeNumericPart = (value, hasSuffix) => {
  if (hasSuffix) {
    return value.replace(',', '.');
  }

  return value.replace(/[.,]/g, '');
};

const normalizeViewerCount = (value) => {
  const count = Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    return undefined;
  }

  return count;
};

const readTwitchRateLimit = (response) => ({
  limit: normalizePositiveInteger(response.headers?.get?.('Ratelimit-Limit')),
  remaining: normalizeNonNegativeInteger(response.headers?.get?.('Ratelimit-Remaining')),
  resetAt: normalizePositiveInteger(response.headers?.get?.('Ratelimit-Reset')),
});

const normalizePositiveInteger = (value) => {
  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

const normalizeNonNegativeInteger = (value) => {
  const number = Number(value);

  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
};

const parseJsonResponse = async (response) => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const createKickApiHeaders = (accessToken) => ({
  Authorization: `Bearer ${normalizeRequiredString(accessToken, 'Kick access token')}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
});

const createStatusError = (message, response) => {
  const error = new Error(message);

  error.status = response.status;
  return error;
};

const isUnauthorizedError = (error) =>
  error?.status === 401 || (error instanceof Error && /status 401|unauthorized/i.test(error.message));

const normalizeRequiredString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

module.exports = {
  KICK_LIVESTREAMS_ENDPOINT,
  TWITCH_STREAMS_ENDPOINT,
  TWITCH_TOKEN_CACHE_TTL_MS,
  clearKickBroadcasterCache,
  clearTwitchTokenValidationCache,
  createRefreshingKickViewerFetcher,
  fetchKickViewerCount,
  fetchTwitchViewerCount,
  normalizeViewerCount,
  parseAbbreviatedCount,
  parseViewerCountText,
  readTwitchRateLimit,
};
