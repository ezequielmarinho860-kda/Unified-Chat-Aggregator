const AUTH_BROWSER_STORAGE_TYPES = [
  'cookies',
  'localstorage',
  'indexdb',
  'cachestorage',
  'serviceworkers',
];

const clearAuthBrowserSession = async (sessionImpl) => {
  if (typeof sessionImpl?.clearStorageData !== 'function') {
    throw new TypeError('Auth browser session storage API is unavailable.');
  }

  await sessionImpl.clearStorageData({ storages: AUTH_BROWSER_STORAGE_TYPES });

  if (typeof sessionImpl.clearCache === 'function') {
    await sessionImpl.clearCache();
  }
};

module.exports = {
  AUTH_BROWSER_STORAGE_TYPES,
  clearAuthBrowserSession,
};
