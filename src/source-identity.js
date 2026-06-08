const createConnectorSource = (connector = {}) => {
  const platform = normalizeRequiredValue(connector.platform);
  const channel = normalizeOptionalValue(connector.channel);

  if (channel) {
    const channelIdentity = resolveChannelIdentity(platform, channel);

    return {
      sourceId: `${platform}:${channelIdentity.key}`,
      platform,
      channelLabel: channelIdentity.channelLabel,
    };
  }

  const liveUrl = normalizeOptionalValue(connector.liveUrl);

  if (!liveUrl) {
    return undefined;
  }

  const liveIdentity = resolveLiveUrlIdentity(liveUrl);

  return {
    sourceId: `${platform}:${liveIdentity.key}`,
    platform,
    ...(liveIdentity.channelLabel ? { channelLabel: liveIdentity.channelLabel } : {}),
  };
};

const resolveChannelIdentity = (platform, channel) => {
  if (platform === 'kick') {
    const normalizedChannel = channel
      .replace(/^https?:\/\/(?:www\.)?kick\.com\//i, '')
      .replace(/^[@#]+/, '');

    return {
      key: normalizeSourceKey(normalizedChannel),
      channelLabel: normalizedChannel,
    };
  }

  if (platform === 'twitch') {
    const normalizedChannel = channel
      .replace(/^https?:\/\/(?:www\.)?twitch\.tv\//i, '')
      .replace(/^[@#]+/, '');

    return {
      key: normalizeSourceKey(normalizedChannel),
      channelLabel: normalizedChannel,
    };
  }

  return {
    key: normalizeSourceKey(channel),
    channelLabel: channel,
  };
};

const resolveLiveUrlIdentity = (liveUrl) => {
  try {
    const parsedUrl = new URL(liveUrl);
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    const handle = resolveXHandle(pathParts);
    const broadcastId = resolveXBroadcastId(pathParts);

    if (handle) {
      return {
        key: normalizeSourceKey(handle),
        channelLabel: `@${handle}`,
      };
    }

    if (broadcastId) {
      return {
        key: `broadcast-${normalizeSourceKey(broadcastId)}`,
      };
    }

    return {
      key: normalizeSourceKey(pathParts.join('-') || parsedUrl.hostname),
    };
  } catch {
    return {
      key: normalizeSourceKey(liveUrl),
      channelLabel: liveUrl,
    };
  }
};

const createConfiguredConnectorSources = (platform, connectorConfig = {}) => {
  if (!connectorConfig?.enabled) {
    return [];
  }

  return getConnectorSourceInputs(platform, connectorConfig)
    .map((sourceConfig, index) => {
      const connectorInput = {
        ...sourceConfig,
        platform,
      };
      const source = createConnectorSource(connectorInput);

      return source
        ? {
            index,
            platform,
            source,
            connectorConfig: sourceConfig,
          }
        : undefined;
    })
    .filter(Boolean);
};

const getConnectorSourceInputs = (platform, connectorConfig = {}) => {
  const sources = Array.isArray(connectorConfig.sources)
    ? connectorConfig.sources
    : createLegacySourceInputs(platform, connectorConfig);

  return sources
    .map((source) => normalizeSourceInput(platform, source))
    .filter((source) => source.enabled);
};

const createLegacySourceInputs = (platform, connectorConfig) => {
  if (platform === 'x') {
    return [
      { enabled: true, liveUrl: connectorConfig.liveUrl },
      { enabled: Boolean(connectorConfig.liveUrl2), liveUrl: connectorConfig.liveUrl2 },
    ];
  }

  return [
    { enabled: true, channel: connectorConfig.channel },
    { enabled: Boolean(connectorConfig.channel2), channel: connectorConfig.channel2 },
  ];
};

const normalizeSourceInput = (platform, source = {}) => {
  if (platform === 'x') {
    return {
      enabled: Boolean(source.enabled),
      liveUrl: normalizeOptionalValue(source.liveUrl),
    };
  }

  return {
    enabled: Boolean(source.enabled),
    channel: normalizeOptionalValue(source.channel),
  };
};

const resolveXHandle = (pathParts) => {
  const [firstPart] = pathParts;

  if (!firstPart || firstPart.toLowerCase() === 'i') {
    return undefined;
  }

  return /^[A-Za-z0-9_]{1,15}$/.test(firstPart) ? firstPart : undefined;
};

const resolveXBroadcastId = (pathParts) => {
  const [firstPart, secondPart, broadcastId] = pathParts;

  if (firstPart?.toLowerCase() !== 'i' || secondPart?.toLowerCase() !== 'broadcasts') {
    return undefined;
  }

  return broadcastId;
};

const normalizeSourceKey = (value) => {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/^[@#]+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'unknown';
};

const normalizeRequiredValue = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Connector source platform must be a non-empty string.');
  }

  return value.trim().toLowerCase();
};

const normalizeOptionalValue = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
};

module.exports = {
  createConnectorSource,
  createConfiguredConnectorSources,
};
