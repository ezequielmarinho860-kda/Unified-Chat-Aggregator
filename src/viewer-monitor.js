const { PLATFORM_ORDER } = require('./app-config');
const { createConfiguredConnectorSources } = require('./source-identity');
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
  let sourceIdentities = new Map();
  let sourceSnapshots = new Map();

  const publish = () => {
    const snapshot = createSnapshot(sourceSnapshots);

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
    const configuredSources = createViewerSourceEntries(connectors).map(applyKnownSourceIdentity);
    const shouldRefreshTwitch =
      connectors.twitch?.enabled && (force || Date.now() >= nextTwitchPollAt);

    if (!connectors.twitch?.enabled) {
      nextTwitchPollAt = 0;
    }

    removeStaleSourceSnapshots(sourceSnapshots, configuredSources);
    markConfiguredSourcesPending(sourceSnapshots, configuredSources, { shouldRefreshTwitch });
    publish();

    const refreshes = configuredSources
      .filter(({ platform }) => platform === 'kick')
      .map((entry) => refreshSource(entry, connectors.kick, fetchKick));

    if (shouldRefreshTwitch) {
      refreshes.push(
        ...configuredSources
          .filter(({ platform }) => platform === 'twitch')
          .map((entry) => refreshSource(entry, connectors.twitch, fetchTwitch)),
      );
    }

    await Promise.all(refreshes);
    return createSnapshot(sourceSnapshots);
  };

  const refreshSource = async (entry, platformConfig, fetchViewerCount) => {
    const startedAt = Date.now();
    const fetchConfig = createViewerFetchConfig(entry, platformConfig);

    try {
      const result = await withTimeout(fetchViewerCount(fetchConfig), timeoutMs);
      const count = typeof result === 'object' ? result.count : result;

      sourceSnapshots.set(entry.source.sourceId, createAvailableSnapshot(entry, count));

      if (entry.platform === 'twitch') {
        nextTwitchPollAt = startedAt + calculateAdaptivePollMs(result?.rateLimit, intervalMs);
      }
    } catch (error) {
      sourceSnapshots.set(entry.source.sourceId, createErrorSnapshot(entry, error));

      if (entry.platform === 'twitch') {
        nextTwitchPollAt = startedAt + calculateAdaptivePollMs(error?.rateLimit, intervalMs);
      }
    }

    publish();
  };

  const updateExternalCount = (target, count) => {
    if (target && typeof target === 'object') {
      rememberSourceIdentity(target);
    }

    const entries = resolveExternalSourceEntries(target);
    const normalizedCount = normalizeViewerCount(count);

    for (const entry of entries) {
      sourceSnapshots.set(
        entry.source.sourceId,
        normalizedCount === undefined
          ? createPendingSnapshot(entry)
          : createAvailableSnapshot(entry, normalizedCount),
      );
    }

    return publish();
  };

  const updateSourceIdentity = (source) =>
    rememberSourceIdentity(source) ? publish() : createSnapshot(sourceSnapshots);

  const resolveExternalSourceEntries = (target) => {
    const connectors = getConfig?.()?.connectors ?? {};
    const configuredSources = createViewerSourceEntries(connectors).map(applyKnownSourceIdentity);

    if (typeof target === 'string') {
      return configuredSources.filter((entry) => entry.platform === target);
    }

    const sourceId = target?.sourceId;
    const matchingEntry = configuredSources.find((entry) => entry.source.sourceId === sourceId);

    return matchingEntry
      ? [{ ...matchingEntry, source: mergeSourceIdentity(matchingEntry.source, target) }]
      : [{ platform: target?.platform, source: target, connectorConfig: {}, index: 0 }];
  };

  const applyKnownSourceIdentity = (entry) => ({
    ...entry,
    source: mergeSourceIdentity(entry.source, sourceIdentities.get(entry.source.sourceId)),
  });

  const rememberSourceIdentity = (source) => {
    if (!isSourceIdentity(source)) {
      return false;
    }

    const currentIdentity = sourceIdentities.get(source.sourceId);
    const nextIdentity = mergeSourceIdentity(currentIdentity, source);
    const snapshot = sourceSnapshots.get(source.sourceId);
    let changed = !areSourceIdentitiesEqual(currentIdentity, nextIdentity);

    sourceIdentities.set(source.sourceId, nextIdentity);

    if (snapshot) {
      const nextSnapshotSource = mergeSourceIdentity(snapshot.source, nextIdentity);

      if (!areSourceIdentitiesEqual(snapshot.source, nextSnapshotSource)) {
        sourceSnapshots.set(source.sourceId, {
          ...snapshot,
          source: nextSnapshotSource,
        });
        changed = true;
      }
    }

    return changed;
  };

  return {
    getSnapshot: () => createSnapshot(sourceSnapshots),
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
    updateSourceIdentity,
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

const createSnapshot = (sourceSnapshots) => {
  const sources = [...sourceSnapshots.values()];
  const platforms = PLATFORM_ORDER.map((platform) =>
    createPlatformSnapshot(platform, sources.filter((source) => source.platform === platform)));

  return {
    platforms,
    sources,
    total: sources.reduce((sum, source) => sum + (source.count ?? 0), 0),
  };
};

const createPlatformSnapshot = (platform, sources) => {
  if (sources.length === 0) {
    return createDisabledPlatformSnapshot(platform);
  }

  const count = sources.reduce((sum, source) => sum + (source.count ?? 0), 0);
  const hasAvailableSource = sources.some((source) => source.state === 'available');
  const hasUnavailableSource = sources.some((source) => source.state === 'unavailable');

  return {
    platform,
    state: hasAvailableSource ? 'available' : hasUnavailableSource ? 'unavailable' : 'disabled',
    count: hasAvailableSource ? count : undefined,
    error: sources.find((source) => source.error)?.error,
    updatedAt: sources
      .map((source) => source.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1),
    sources,
  };
};

const createDisabledPlatformSnapshot = (platform) => ({
  platform,
  state: 'disabled',
  count: undefined,
  error: undefined,
  updatedAt: new Date().toISOString(),
  sources: [],
});

const createPendingSnapshot = (entry) => ({
  platform: entry.platform,
  source: entry.source,
  state: 'unavailable',
  count: undefined,
  error: undefined,
  updatedAt: new Date().toISOString(),
});

const createAvailableSnapshot = (entry, count) => ({
  platform: entry.platform,
  source: entry.source,
  state: 'available',
  count: normalizeViewerCount(count) ?? 0,
  error: undefined,
  updatedAt: new Date().toISOString(),
});

const createErrorSnapshot = (entry, error) => ({
  platform: entry.platform,
  source: entry.source,
  state: 'unavailable',
  count: undefined,
  error: error instanceof Error ? error.message : String(error),
  updatedAt: new Date().toISOString(),
});

const createViewerSourceEntries = (connectors = {}) =>
  PLATFORM_ORDER.flatMap((platform) =>
    createConfiguredConnectorSources(platform, connectors[platform]).map((entry) => ({
      ...entry,
      platformConfig: connectors[platform],
    })));

const createViewerFetchConfig = (entry, platformConfig = {}) => ({
  ...platformConfig,
  ...entry.connectorConfig,
  chatroomId: entry.platform === 'kick' && entry.index > 0 ? '' : platformConfig.chatroomId,
});

const SOURCE_IDENTITY_FIELDS = ['sourceId', 'platform', 'broadcasterName', 'channelLabel'];

const mergeSourceIdentity = (currentSource, patchSource) => {
  const nextSource = { ...(currentSource ?? {}) };

  for (const field of SOURCE_IDENTITY_FIELDS) {
    const value = patchSource?.[field];

    if (value !== undefined && value !== null && value !== '') {
      if (
        field === 'channelLabel' &&
        isFallbackXLiveLabel(value) &&
        currentSource?.channelLabel &&
        !isFallbackXLiveLabel(currentSource.channelLabel)
      ) {
        continue;
      }

      nextSource[field] = value;
    }
  }

  return nextSource;
};

const isFallbackXLiveLabel = (value) => /^X Live \d+$/i.test(String(value ?? '').trim());

const isSourceIdentity = (source) =>
  source &&
  typeof source === 'object' &&
  typeof source.sourceId === 'string' &&
  source.sourceId.trim().length > 0;

const areSourceIdentitiesEqual = (left, right) =>
  SOURCE_IDENTITY_FIELDS.every((field) => left?.[field] === right?.[field]);

const removeStaleSourceSnapshots = (sourceSnapshots, configuredSources) => {
  const configuredSourceIds = new Set(configuredSources.map((entry) => entry.source.sourceId));

  for (const sourceId of sourceSnapshots.keys()) {
    if (!configuredSourceIds.has(sourceId)) {
      sourceSnapshots.delete(sourceId);
    }
  }
};

const markConfiguredSourcesPending = (
  sourceSnapshots,
  configuredSources,
  { shouldRefreshTwitch },
) => {
  for (const entry of configuredSources) {
    const previousSnapshot = sourceSnapshots.get(entry.source.sourceId);

    if (entry.platform === 'twitch' && !shouldRefreshTwitch) {
      continue;
    }

    if (previousSnapshot?.state !== 'available') {
      sourceSnapshots.set(entry.source.sourceId, createPendingSnapshot(entry));
    }
  }
};

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
