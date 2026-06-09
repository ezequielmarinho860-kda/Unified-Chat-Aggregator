const fs = require('node:fs');
const path = require('node:path');

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
  return normalizedSource;
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
  normalizeBrowserBackendConfig,
};
