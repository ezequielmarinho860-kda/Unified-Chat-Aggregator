const SEVENTV_API_ORIGIN = 'https://7tv.io/v3';
const SEVENTV_CDN_ORIGIN = 'https://cdn.7tv.app/emote';

const fetchSevenTvEmoteCatalog = async ({
  provider = 'twitch',
  providerId,
  fetchImpl = fetch,
} = {}) => {
  const globalSet = await fetchSevenTvJson(`${SEVENTV_API_ORIGIN}/emote-sets/global`, fetchImpl);
  let channelEmotes = [];

  if (providerId) {
    try {
      const user = await fetchSevenTvJson(
        `${SEVENTV_API_ORIGIN}/users/${encodeURIComponent(provider)}/${encodeURIComponent(providerId)}`,
        fetchImpl,
      );

      channelEmotes = Array.isArray(user?.emote_set?.emotes) ? user.emote_set.emotes : [];
    } catch {
      channelEmotes = [];
    }
  }

  return createSevenTvEmoteCatalog([
    ...(Array.isArray(globalSet?.emotes) ? globalSet.emotes : []),
    ...channelEmotes,
  ]);
};

const fetchSevenTvJson = async (url, fetchImpl) => {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`7TV request failed with status ${response.status}.`);
  }

  return response.json();
};

const createSevenTvEmoteCatalog = (emotes = []) => {
  const catalog = {};

  for (const emote of emotes) {
    const id = normalizeString(emote?.data?.id ?? emote?.id);
    const code = normalizeString(emote?.name ?? emote?.data?.name);

    if (!id || !code) {
      continue;
    }

    catalog[code] = {
      id,
      code,
      imageUrl: `${SEVENTV_CDN_ORIGIN}/${encodeURIComponent(id)}/2x.webp`,
      animated: Boolean(emote?.data?.animated),
      provider: '7tv',
    };
  }

  return catalog;
};

const normalizeString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';

module.exports = {
  SEVENTV_API_ORIGIN,
  SEVENTV_CDN_ORIGIN,
  createSevenTvEmoteCatalog,
  fetchSevenTvEmoteCatalog,
};
