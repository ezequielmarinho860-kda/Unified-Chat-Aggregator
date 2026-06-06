const { PLATFORM_ORDER } = require('./app-config');
const {
  fetchKickViewerCount,
  fetchTwitchViewerCount,
  normalizeViewerCount,
} = require('./viewer-counts');

const DEFAULT_VIEWER_POLL_MS = 10_000;
const DEFAULT_VIEWER_TIMEOUT_MS = 10_000;
const TWITCH_RATE_LIMIT_RESERVE = 10;

const createViewerMonitor = ({
  getConfig,
  onUpdate = () => {},
  intervalMs = DEFAULT_VIEWER_POLL_MS,
  timeoutMs = DEFAULT_VIEWER_TIMEOUT_MS,
  fetchTwitch = fetchTwitchViewerCount,
  fetchKick = fetchKickViewerCount,
} = {}) => {
  let timer;
  let running = false;
  let refreshPromise;
  let nextTwitchPollAt = 0;
  let platforms = createPlatformSnapshots();

  const publish = () => {
    const snapshot = createSnapshot(platforms);

    onUpdate(snapshot);
    return snapshot;
  };

  const refresh = async ({ force = true } = {}) => {
    if (refreshPromise) {
      return refreshPromise;
    }

    const startedAt = Date.now();

    refreshPromise = refreshConfiguredPlatforms({ force });

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = undefined;
      scheduleNextRefresh(startedAt);
    }
  };

  const refreshConfiguredPlatforms = async ({ force }) => {
    const config = getConfig?.();
    const connectors = config?.connectors ?? {};
    const shouldRefreshTwitch =
      connectors.twitch?.enabled && (force || Date.now() >= nextTwitchPollAt);

    if (!connectors.twitch?.enabled) {
      nextTwitchPollAt = 0;
    }

    platforms = {
      ...platforms,
      twitch: shouldRefreshTwitch
        ? createRefreshSnapshot(platforms.twitch, 'twitch', connectors.twitch)
        : platforms.twitch,
      kick: createRefreshSnapshot(platforms.kick, 'kick', connectors.kick),
      x: createExternalSnapshot(platforms.x, connectors.x),
    };
    publish();

    const refreshes = [refreshPlatform('kick', connectors.kick, fetchKick)];

    if (shouldRefreshTwitch) {
      refreshes.push(refreshPlatform('twitch', connectors.twitch, fetchTwitch));
    }

    await Promise.all(refreshes);
    return createSnapshot(platforms);
  };

  const refreshPlatform = async (platform, config, fetchViewerCount) => {
    if (!config?.enabled) {
      return;
    }

    const startedAt = Date.now();

    try {
      const result = await withTimeout(fetchViewerCount(config), timeoutMs);
      const count = typeof result === 'object' ? result.count : result;

      platforms[platform] = createAvailableSnapshot(platform, count);

      if (platform === 'twitch') {
        nextTwitchPollAt = startedAt + calculateAdaptivePollMs(result?.rateLimit, intervalMs);
      }
    } catch (error) {
      platforms[platform] = createErrorSnapshot(platform, error);

      if (platform === 'twitch') {
        nextTwitchPollAt = startedAt + calculateAdaptivePollMs(error?.rateLimit, intervalMs);
      }
    }

    publish();
  };

  const updateExternalCount = (platform, count) => {
    const config = getConfig?.()?.connectors?.[platform];

    if (!config?.enabled) {
      platforms[platform] = createDisabledSnapshot(platform);
    } else {
      const normalizedCount = normalizeViewerCount(count);

      platforms[platform] = normalizedCount === undefined
        ? createPendingSnapshot(platform, config)
        : createAvailableSnapshot(platform, normalizedCount);
    }

    return publish();
  };

  return {
    getSnapshot: () => createSnapshot(platforms),
    refresh,
    start: () => {
      running = true;
      clearTimeout(timer);
      void refresh();
    },
    stop: () => {
      running = false;
      clearTimeout(timer);
      timer = undefined;
    },
    updateExternalCount,
  };

  function scheduleNextRefresh(startedAt) {
    clearTimeout(timer);
    if (running) {
      timer = setTimeout(() => {
        timer = undefined;
        void refresh({ force: false });
      }, calculateFixedCadenceDelay(startedAt, intervalMs));
    }
  }
};

const createPlatformSnapshots = () =>
  Object.fromEntries(PLATFORM_ORDER.map((platform) => [platform, createDisabledSnapshot(platform)]));

const createSnapshot = (platforms) => ({
  platforms: PLATFORM_ORDER.map((platform) => platforms[platform]),
  total: PLATFORM_ORDER.reduce((sum, platform) => sum + (platforms[platform]?.count ?? 0), 0),
});

const createDisabledSnapshot = (platform) => ({
  platform,
  state: 'disabled',
  count: undefined,
  error: undefined,
  updatedAt: new Date().toISOString(),
});

const createPendingSnapshot = (platform, config) =>
  config?.enabled
    ? {
        platform,
        state: 'unavailable',
        count: undefined,
        error: undefined,
        updatedAt: new Date().toISOString(),
      }
    : createDisabledSnapshot(platform);

const createExternalSnapshot = (previousSnapshot, config) => {
  if (!config?.enabled) {
    return createDisabledSnapshot('x');
  }

  return previousSnapshot?.state === 'available'
    ? previousSnapshot
    : createPendingSnapshot('x', config);
};

const createRefreshSnapshot = (previousSnapshot, platform, config) => {
  if (!config?.enabled) {
    return createDisabledSnapshot(platform);
  }

  return previousSnapshot?.state === 'available'
    ? previousSnapshot
    : createPendingSnapshot(platform, config);
};

const createAvailableSnapshot = (platform, count) => ({
  platform,
  state: 'available',
  count: normalizeViewerCount(count) ?? 0,
  error: undefined,
  updatedAt: new Date().toISOString(),
});

const createErrorSnapshot = (platform, error) => ({
  platform,
  state: 'unavailable',
  count: undefined,
  error: error instanceof Error ? error.message : String(error),
  updatedAt: new Date().toISOString(),
});

const withTimeout = async (promise, timeoutMs) => {
  let timer;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Viewer lookup timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const calculateAdaptivePollMs = (rateLimit = {}, baseIntervalMs = DEFAULT_VIEWER_POLL_MS) => {
  const remaining = Number(rateLimit.remaining);
  const resetAt = Number(rateLimit.resetAt);

  if (!Number.isSafeInteger(remaining) || !Number.isSafeInteger(resetAt)) {
    return baseIntervalMs;
  }

  const msUntilReset = Math.max(0, resetAt * 1000 - Date.now());

  if (remaining <= TWITCH_RATE_LIMIT_RESERVE) {
    return Math.max(baseIntervalMs, msUntilReset + 1_000);
  }

  const sustainableInterval = Math.ceil(
    msUntilReset / Math.max(1, remaining - TWITCH_RATE_LIMIT_RESERVE),
  );

  return Math.max(baseIntervalMs, sustainableInterval);
};

const calculateFixedCadenceDelay = (startedAt, intervalMs, now = Date.now()) =>
  Math.max(0, intervalMs - Math.max(0, now - startedAt));

module.exports = {
  DEFAULT_VIEWER_POLL_MS,
  DEFAULT_VIEWER_TIMEOUT_MS,
  TWITCH_RATE_LIMIT_RESERVE,
  calculateAdaptivePollMs,
  calculateFixedCadenceDelay,
  createViewerMonitor,
};
