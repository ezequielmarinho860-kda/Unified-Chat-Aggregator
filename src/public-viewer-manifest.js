const { createPublicViewerSources } = require('./public-viewer-sources');

const DEFAULT_PUBLIC_VIEWER_TITLE = 'Unified Chat Aggregator';

const createPublicViewerManifestContext = ({ title, config } = {}) => {
  const sourcesByPlatform = createPublicViewerSources(config);
  const manifest = normalizePublicViewerManifest({
    title,
    sources: Object.values(sourcesByPlatform),
  });

  return {
    manifest,
    sources: Object.fromEntries(manifest.sources.map((source) => [source.sourceId, source])),
  };
};

const normalizePublicViewerManifest = (manifest = {}) => ({
  title: normalizeTitle(manifest.title),
  sources: Array.isArray(manifest.sources)
    ? manifest.sources.map(normalizePublicManifestSource)
    : [],
});

const normalizePublicManifestSource = (source = {}) => {
  const normalizedSource = {
    sourceId: requireString(source.sourceId, 'source.sourceId'),
    platform: requireString(source.platform, 'source.platform'),
    broadcasterName: optionalString(source.broadcasterName),
    channelLabel: optionalString(source.channelLabel),
    watchUrl: optionalHttpUrl(source.watchUrl, 'source.watchUrl'),
    player: normalizePublicPlayer(source.player),
  };

  return compactObject(normalizedSource);
};

const normalizePublicPlayer = (player) => {
  if (!player || typeof player !== 'object') {
    return undefined;
  }

  if (player.provider !== 'twitch') {
    throw new TypeError('Public viewer player provider must be twitch.');
  }

  return {
    provider: 'twitch',
    channel: requireString(player.channel, 'player.channel'),
  };
};

const normalizeTitle = (title) =>
  typeof title === 'string' && title.trim().length > 0
    ? title.trim()
    : DEFAULT_PUBLIC_VIEWER_TITLE;

const optionalHttpUrl = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const url = new URL(value.trim());

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError(`Public viewer ${fieldName} must be an HTTP URL.`);
  }

  return url.toString();
};

const requireString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Public viewer ${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

const optionalString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));

module.exports = {
  DEFAULT_PUBLIC_VIEWER_TITLE,
  createPublicViewerManifestContext,
  normalizePublicViewerManifest,
};
