const KICK_CHANNEL_ENDPOINT = 'https://kick.com/api/v2/channels';

const resolveKickChannel = async ({ channel, fetchImpl = fetch } = {}) => {
  const normalizedChannel = normalizeKickChannelName(channel);
  const channelResponse = await fetchKickJson(
    `${KICK_CHANNEL_ENDPOINT}/${encodeURIComponent(normalizedChannel)}`,
    fetchImpl,
  );

  if (channelResponse?.chatroom?.id) {
    return {
      channel: normalizedChannel,
      channelId: normalizeOptionalId(channelResponse.id),
      chatroomId: normalizeRequiredId(channelResponse.chatroom.id, 'chatroom.id'),
    };
  }

  const chatroomResponse = await fetchKickJson(
    `${KICK_CHANNEL_ENDPOINT}/${encodeURIComponent(normalizedChannel)}/chatroom`,
    fetchImpl,
  );

  return {
    channel: normalizedChannel,
    channelId: normalizeOptionalId(chatroomResponse.channel_id),
    chatroomId: normalizeRequiredId(chatroomResponse.id, 'chatroom.id'),
  };
};

const fetchKickJson = async (url, fetchImpl) => {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://kick.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Kick request failed with status ${response.status}.`);
  }

  return response.json();
};

const normalizeKickChannelName = (channel) => {
  if (typeof channel !== 'string' || channel.trim().length === 0) {
    throw new TypeError('Kick channel must be a non-empty string.');
  }

  return channel.trim().replace(/^@/, '').toLowerCase();
};

const normalizeRequiredId = (value, fieldName) => {
  const normalized = normalizeOptionalId(value);

  if (!normalized) {
    throw new TypeError(`Kick ${fieldName} must be present.`);
  }

  return normalized;
};

const normalizeOptionalId = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return String(value);
};

module.exports = {
  resolveKickChannel,
  normalizeKickChannelName,
};
