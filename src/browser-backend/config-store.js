const fs = require('node:fs');
const path = require('node:path');
const { createPublicViewerManifestContext } = require('../public-viewer-manifest');

const DEFAULT_BROWSER_BACKEND_CONFIG = Object.freeze({
  sources: {
    kick: [createDefaultSourceEntry('channel'), createDefaultSourceEntry('channel')],
    twitch: [createDefaultSourceEntry('channel'), createDefaultSourceEntry('channel')],
    x: [createDefaultSourceEntry('liveUrl'), createDefaultSourceEntry('liveUrl')],
  },
  viewer: {
    showExternalChats: true,
    theme: 'dark',
    title: 'Unified Chat Aggregator',
  },
});

const createBrowserBackendConfigStore = (configPath) => {
  const exists = () => fs.existsSync(configPath);

  const load = () => {
    try {
      if (!exists()) {
        return normalizeBrowserBackendConfig(DEFAULT_BROWSER_BACKEND_CONFIG);
      }

      const rawConfig = fs.readFileSync(configPath, 'utf8');
      return normalizeBrowserBackendConfig(JSON.parse(rawConfig));
    } catch {
      return normalizeBrowserBackendConfig(DEFAULT_BROWSER_BACKEND_CONFIG);
    }
  };

  const save = (config) => {
    const normalizedConfig = normalizeBrowserBackendConfig(config);

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`);

    return normalizedConfig;
  };

  return {
    configPath,
    exists,
    load,
    save,
  };
};

const normalizeBrowserBackendConfig = (config = {}) => {
  const input = config && typeof config === 'object' && !Array.isArray(config) ? config : {};

  return {
    sources: {
      kick: normalizePlatformSources(input.sources?.kick, 'channel'),
      twitch: normalizePlatformSources(input.sources?.twitch, 'channel'),
      x: normalizePlatformSources(input.sources?.x, 'liveUrl'),
    },
    viewer: {
      showExternalChats: normalizeBoolean(input.viewer?.showExternalChats, true),
      theme: normalizeViewerTheme(input.viewer?.theme),
      title: normalizeString(input.viewer?.title, 'Unified Chat Aggregator'),
    },
  };
};

const createPublicManifestFromBrowserBackendConfig = (config = {}) => {
  const normalizedConfig = normalizeBrowserBackendConfig(config);

  return createPublicViewerManifestContext({
    config: createRuntimeConfigFromBrowserBackendConfig(normalizedConfig),
    title: normalizedConfig.viewer.title,
  }).manifest;
};

const createRuntimeConfigFromBrowserBackendConfig = (config = {}) => {
  const normalizedConfig = normalizeBrowserBackendConfig(config);

  return {
    connectors: {
      kick: createRuntimeConnectorConfig(normalizedConfig.sources.kick, 'channel'),
      twitch: createRuntimeConnectorConfig(normalizedConfig.sources.twitch, 'channel'),
      x: createRuntimeConnectorConfig(normalizedConfig.sources.x, 'liveUrl'),
    },
  };
};

const createRuntimeConnectorConfig = (sources, fieldName) => ({
  enabled: sources.some((source) => source.enabled),
  sources: sources.map((source) => ({
    enabled: source.enabled,
    [fieldName]: source[fieldName],
  })),
});

const normalizePlatformSources = (sources, fieldName) => {
  const inputSources = Array.isArray(sources) ? sources : [];
  const nextSources = inputSources.slice(0, 2).map((source) =>
    normalizeSourceEntry(source, fieldName),
  );

  while (nextSources.length < 2) {
    nextSources.push(createDefaultSourceEntry(fieldName));
  }

  return nextSources;
};

const normalizeSourceEntry = (source = {}, fieldName) => {
  const normalizedSource = {
    enabled: normalizeBoolean(source.enabled, false),
  };

  normalizedSource[fieldName] = normalizeString(source[fieldName], '');
  validateSourceEntry(normalizedSource, fieldName);
  return normalizedSource;
};

const validateSourceEntry = (source, fieldName) => {
  const value = source[fieldName];

  if (!source.enabled) {
    return;
  }

  if (!value) {
    throw new TypeError(`Enabled ${fieldName} source requires a value.`);
  }

  if (fieldName === 'liveUrl') {
    validateXLiveUrl(value);
  }
};

const validateXLiveUrl = (value) => {
  try {
    const parsedUrl = new URL(value);
    const hostname = parsedUrl.hostname.replace(/^www\./, '');

    if (!['x.com', 'twitter.com'].includes(hostname)) {
      throw new TypeError('X source URL must use x.com or twitter.com.');
    }
  } catch (error) {
    if (error instanceof TypeError && /x\.com|twitter\.com/.test(error.message)) {
      throw error;
    }

    const handle = value.replace(/^[@#]+/, '');

    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      throw new TypeError('X source must be an X URL or handle.');
    }
  }
};

function createDefaultSourceEntry(fieldName) {
  const source = { enabled: false };

  source[fieldName] = '';
  return source;
}

const normalizeViewerTheme = (theme) => {
  const normalizedTheme = normalizeString(theme, 'dark').toLowerCase();

  return ['dark', 'light'].includes(normalizedTheme) ? normalizedTheme : 'dark';
};

const normalizeBoolean = (value, defaultValue) =>
  typeof value === 'boolean' ? value : defaultValue;

const normalizeString = (value, defaultValue) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : defaultValue;

module.exports = {
  DEFAULT_BROWSER_BACKEND_CONFIG,
  createBrowserBackendConfigStore,
  createPublicManifestFromBrowserBackendConfig,
  createRuntimeConfigFromBrowserBackendConfig,
  normalizeBrowserBackendConfig,
};
