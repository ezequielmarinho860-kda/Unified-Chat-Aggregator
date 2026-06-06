const BTTV_API_ORIGIN = 'https://api.betterttv.net/3';
const BTTV_CDN_ORIGIN = 'https://cdn.betterttv.net/emote';

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
  fetchBttvEmoteCatalog,
};
