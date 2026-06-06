const X_AUTH_COOKIE_URLS = ['https://x.com', 'https://twitter.com'];
const X_AUTH_COOKIE_NAME = 'auth_token';
const X_STORAGE_TYPES = ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'];

const getXSessionAuthStatus = async (sessionImpl) => {
  const cookies = await getXSessionCookies(sessionImpl);

  return {
    connected: cookies.some((cookie) => cookie.name === X_AUTH_COOKIE_NAME),
  };
};

const clearXSessionAuth = async (sessionImpl) => {
  const cookies = await getXSessionCookies(sessionImpl);

  await Promise.all(cookies.map((cookie) => removeCookie(sessionImpl, cookie)));

  if (typeof sessionImpl?.clearStorageData === 'function') {
    await Promise.all(
      X_AUTH_COOKIE_URLS.map((origin) =>
        sessionImpl.clearStorageData({
          origin,
          storages: X_STORAGE_TYPES,
        }),
      ),
    );
  }
};

const getXSessionCookies = async (sessionImpl) => {
  if (typeof sessionImpl?.cookies?.get !== 'function') {
    throw new TypeError('X session cookies API is unavailable.');
  }

  const cookieGroups = await Promise.all(
    X_AUTH_COOKIE_URLS.map((url) => sessionImpl.cookies.get({ url })),
  );

  return dedupeCookies(cookieGroups.flat());
};

const dedupeCookies = (cookies) => {
  const seen = new Set();
  const uniqueCookies = [];

  for (const cookie of cookies) {
    const key = [cookie.domain, cookie.path, cookie.name].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueCookies.push(cookie);
  }

  return uniqueCookies;
};

const removeCookie = async (sessionImpl, cookie) => {
  const domain = String(cookie.domain || 'x.com').replace(/^\./, '');
  const path = cookie.path || '/';
  const protocol = cookie.secure === false ? 'http' : 'https';

  await sessionImpl.cookies.remove(`${protocol}://${domain}${path}`, cookie.name);
};

module.exports = {
  clearXSessionAuth,
  getXSessionAuthStatus,
  X_AUTH_COOKIE_NAME,
};
