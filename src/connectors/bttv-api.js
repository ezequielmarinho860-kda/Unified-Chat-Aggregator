const BTTV_API_ORIGIN = 'https://api.betterttv.net/3';
const BTTV_CDN_ORIGIN = 'https://cdn.betterttv.net/emote';
const MAX_SHARED_EMOTE_CANDIDATES = 5;

const fetchBttvEmoteCatalog = async ({
  provider = 'twitch',
  providerId,
  fetchImpl = fetch,
} = {}) => {
  const globalEmotes = await fetchBttvJson(`${BTTV_API_ORIGIN}/cached/emotes/global`, fetchImpl);
  let channelEmotes = [];

  if (providerId) {
    try {
      const user = await fetchBttvJson(
        `${BTTV_API_ORIGIN}/cached/users/${encodeURIComponent(provider)}/${encodeURIComponent(providerId)}`,
        fetchImpl,
      );

      channelEmotes = [
        ...(Array.isArray(user?.channelEmotes) ? user.channelEmotes : []),
        ...(Array.isArray(user?.sharedEmotes) ? user.sharedEmotes : []),
      ];
    } catch {
      channelEmotes = [];
    }
  }

  return createBttvEmoteCatalog([
    ...(Array.isArray(globalEmotes) ? globalEmotes : []),
    ...channelEmotes,
  ]);
};

const fetchBttvJson = async (url, fetchImpl) => {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`BetterTTV request failed with status ${response.status}.`);
  }

  return response.json();
};

const fetchBttvSharedEmote = async ({ code, fetchImpl = fetch } = {}) => {
  const normalizedCode = normalizeString(code);

  if (!normalizedCode) {
    return undefined;
  }

  const url = new URL(`${BTTV_API_ORIGIN}/emotes/shared/search`);

  url.searchParams.set('query', normalizedCode);
  url.searchParams.set('offset', '0');
  url.searchParams.set('limit', '10');

  const results = await fetchBttvJson(url.toString(), fetchImpl);
  const exactMatch = Array.isArray(results)
    ? results.find((emote) => emote?.code === normalizedCode)
    : undefined;

  return exactMatch ? createBttvEmoteCatalog([exactMatch])[normalizedCode] : undefined;
};

const findBttvSharedEmoteCandidates = (text, catalog = {}, limit = MAX_SHARED_EMOTE_CANDIDATES) => {
  if (typeof text !== 'string') {
    return [];
  }

  const candidates = [];

  for (const token of text.split(/\s+/u)) {
    const code = token.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, '');

    if (!isLikelySharedEmoteCode(code) || catalog[code] || candidates.includes(code)) {
      continue;
    }

    candidates.push(code);

    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
};

const isLikelySharedEmoteCode = (code) => {
  if (!/^[A-Za-z0-9_]{3,32}$/u.test(code)) {
    return false;
  }

  const hasUppercase = /[A-Z]/u.test(code);
  const hasLowercase = /[a-z]/u.test(code);

  return hasUppercase && (!hasLowercase || /[a-z][A-Z]|[A-Z][a-z]/u.test(code));
};

const createBttvEmoteCatalog = (emotes = []) => {
  const catalog = {};

  for (const emote of emotes) {
    const id = normalizeString(emote?.id);
    const code = normalizeString(emote?.code);

    if (!id || !code) {
      continue;
    }

    catalog[code] = {
      id,
      code,
      imageUrl: `${BTTV_CDN_ORIGIN}/${encodeURIComponent(id)}/2x`,
      animated: Boolean(emote.animated),
    };
  }

  return catalog;
};

const normalizeString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';

module.exports = {
  BTTV_API_ORIGIN,
  BTTV_CDN_ORIGIN,
  createBttvEmoteCatalog,
  fetchBttvSharedEmote,
  fetchBttvEmoteCatalog,
  findBttvSharedEmoteCandidates,
};
