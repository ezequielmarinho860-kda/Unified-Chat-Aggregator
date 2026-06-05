const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_APP_CONFIG, normalizeAppConfig } = require('./app-config');

const createAppConfigStore = (configPath) => {
  const exists = () => fs.existsSync(configPath);

  const load = () => {
    try {
      if (!exists()) {
        return normalizeAppConfig(DEFAULT_APP_CONFIG);
      }

      const rawConfig = fs.readFileSync(configPath, 'utf8');
      return normalizeAppConfig(JSON.parse(rawConfig));
    } catch {
      return normalizeAppConfig(DEFAULT_APP_CONFIG);
    }
  };

  const save = (config) => {
    const normalizedConfig = normalizeAppConfig(config);

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

module.exports = {
  createAppConfigStore,
};
