const createBrowserBackendSnapshotState = ({
  initialSnapshot = {},
  now = () => new Date(),
} = {}) => {
  let snapshot = normalizeSnapshot(initialSnapshot, now);

  const applyEvent = (event = {}) => {
    if (event.type === 'snapshot.replace') {
      snapshot = normalizeSnapshot(event.data, now);
    } else if (event.type === 'source.status') {
      snapshot = {
        ...snapshot,
        generatedAt: now().toISOString(),
        statuses: upsertStatus(snapshot.statuses, event.data),
      };
    } else if (event.type === 'viewers.update') {
      snapshot = {
        ...snapshot,
        generatedAt: now().toISOString(),
        viewers: event.data ?? { sources: [], total: 0 },
      };
    } else if (event.type === 'manifest.update') {
      snapshot = {
        ...snapshot,
        generatedAt: now().toISOString(),
        manifest: event.data ?? {},
      };
    }

    return snapshot;
  };

  return {
    applyEvent,
    getSnapshot: () => snapshot,
  };
};

const normalizeSnapshot = (snapshot = {}, now) => ({
  generatedAt: typeof snapshot.generatedAt === 'string' ? snapshot.generatedAt : now().toISOString(),
  manifest: snapshot.manifest ?? { sources: [], title: 'Unified Chat Aggregator' },
  protocolVersion: '1',
  statuses: Array.isArray(snapshot.statuses) ? snapshot.statuses : [],
  viewers: snapshot.viewers ?? { sources: [], total: 0 },
});

const upsertStatus = (statuses = [], status) => {
  const sourceId = status?.source?.sourceId;

  if (!sourceId) {
    return statuses;
  }

  const nextStatuses = [...statuses];
  const index = nextStatuses.findIndex((existing) => existing.source?.sourceId === sourceId);

  if (index >= 0) {
    nextStatuses[index] = status;
  } else {
    nextStatuses.push(status);
  }

  return nextStatuses;
};

module.exports = {
  createBrowserBackendSnapshotState,
};
