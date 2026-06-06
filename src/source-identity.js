const createConnectorSource = (connector = {}) => {
  const platform = normalizeRequiredValue(connector.platform);
  const channel = normalizeOptionalValue(connector.channel);

  if (channel) {
    return {
      sourceId: `${platform}:${normalizeSourceKey(channel)}`,
      platform,
      channelLabel: channel,
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
};
