const { randomUUID } = require('node:crypto');

const PROTOCOL_VERSION = '1';

const createPublicEvent = (
  type,
  data,
  { eventId = randomUUID(), emittedAt = nowIso() } = {},
) => ({
  protocolVersion: PROTOCOL_VERSION,
  type: requireString(type, 'event.type'),
  eventId: requireString(eventId, 'event.eventId'),
  emittedAt: requireString(emittedAt, 'event.emittedAt'),
  data,
});

const serializePublicSource = (source) => {
  if (!source || typeof source !== 'object') {
    throw new TypeError('Public source is required.');
  }

  return compactObject({
    sourceId: requireString(source.sourceId, 'source.sourceId'),
    platform: requireString(source.platform, 'source.platform'),
    broadcasterName: optionalString(source.broadcasterName),
    channelLabel: optionalString(source.channelLabel),
  });
};

const serializePublicChatMessage = (message) => {
  if (!message || typeof message !== 'object') {
    throw new TypeError('Public chat message is required.');
  }

  return compactObject({
    id: requireString(message.id, 'message.id'),
    source: serializePublicSource(message.source),
    author: serializePublicAuthor(message.author),
    text: requireString(message.text, 'message.text'),
    timestamp: requireString(message.timestamp, 'message.timestamp'),
    avatarUrl: optionalString(message.avatarUrl),
    fragments: serializePublicFragments(message.fragments),
  });
};

const serializePublicStatus = (status, { sources = {}, generatedAt = nowIso() } = {}) => {
  if (!status || typeof status !== 'object') {
    throw new TypeError('Public source status is required.');
  }

  return compactObject({
    source: resolvePublicSource(status, sources),
    state: requireString(status.state, 'status.state'),
    messageCount: optionalNonNegativeInteger(status.messageCount),
    lastMessageAt: optionalString(status.lastMessageAt),
    updatedAt: requireString(generatedAt, 'status.updatedAt'),
  });
};

const serializePublicViewers = (snapshot = {}, { sources = {} } = {}) => {
  const sourceViewers = Array.isArray(snapshot.platforms)
    ? snapshot.platforms
      .filter((viewer) => hasPublicSource(viewer, sources))
      .map((viewer) => serializePublicViewer(viewer, sources))
    : [];

  return {
    sources: sourceViewers,
    total: sourceViewers.reduce((sum, viewer) => sum + (viewer.count ?? 0), 0),
  };
};

const serializePublicSnapshot = (
  { manifest, statuses = [], viewers } = {},
  { sources = {}, generatedAt = nowIso() } = {},
) => ({
  protocolVersion: PROTOCOL_VERSION,
  generatedAt: requireString(generatedAt, 'snapshot.generatedAt'),
  manifest: serializePublicManifest(manifest, sources),
  statuses: statuses
    .filter((status) => hasPublicSource(status, sources))
    .map((status) => serializePublicStatus(status, { sources, generatedAt })),
  viewers: serializePublicViewers(viewers, { sources }),
});

const serializePublicManifest = (manifest = {}, sources = {}) => ({
  title: optionalString(manifest.title) ?? 'Unified Chat Aggregator',
  sources: Object.values(sources).map(serializePublicSource),
});

const serializePublicViewer = (viewer, sources) => {
  const state = requireString(viewer.state, 'viewer.state');

  return compactObject({
    source: resolvePublicSource(viewer, sources),
    state,
    count: state === 'available' ? optionalNonNegativeInteger(viewer.count) ?? 0 : undefined,
    updatedAt: optionalString(viewer.updatedAt),
  });
};

const serializePublicAuthor = (author) => {
  if (!author || typeof author !== 'object') {
    throw new TypeError('Public chat author is required.');
  }

  return compactObject({
    id: requireString(author.id, 'author.id'),
    name: requireString(author.name, 'author.name'),
    avatarUrl: optionalString(author.avatarUrl),
    badges: Array.isArray(author.badges) ? author.badges.map(serializePublicBadge) : [],
  });
};

const serializePublicBadge = (badge) =>
  compactObject({
    id: requireString(badge?.id, 'badge.id'),
    label: requireString(badge?.label, 'badge.label'),
    version: optionalString(badge?.version),
    imageUrl: optionalString(badge?.imageUrl),
  });

const serializePublicFragments = (fragments) => {
  if (!Array.isArray(fragments)) {
    return undefined;
  }

  return fragments.map((fragment) =>
    compactObject({
      type: requireString(fragment?.type, 'fragment.type'),
      text: requireString(fragment?.text, 'fragment.text'),
      id: optionalString(fragment?.id),
      imageUrl: optionalString(fragment?.imageUrl),
    }));
};

const resolvePublicSource = (value, sources) =>
  serializePublicSource(value.source ?? sources[value.platform]);

const hasPublicSource = (value, sources) => Boolean(value?.source ?? sources[value?.platform]);

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));

const requireString = (value, fieldName) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Public realtime ${fieldName} must be a non-empty string.`);
  }

  return value;
};

const optionalString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const optionalNonNegativeInteger = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const nowIso = () => new Date().toISOString();

module.exports = {
  PROTOCOL_VERSION,
  createPublicEvent,
  serializePublicChatMessage,
  serializePublicSnapshot,
  serializePublicSource,
  serializePublicStatus,
  serializePublicViewers,
};
