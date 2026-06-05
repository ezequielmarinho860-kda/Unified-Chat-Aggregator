const { normalizeKickChannelName, resolveKickChannel } = require('./kick-resolver');

const KICK_ORIGIN = 'https://kick.com';
const DEFAULT_BROWSER_TIMEOUT_MS = 20_000;

const resolveKickChannelInBrowser = async ({
  channel,
  BrowserWindow,
  show = false,
  timeoutMs = DEFAULT_BROWSER_TIMEOUT_MS,
} = {}) => {
  if (!BrowserWindow) {
    throw new TypeError('BrowserWindow is required to resolve Kick in browser.');
  }

  const normalizedChannel = normalizeKickChannelName(channel);
  const resolverWindow = new BrowserWindow({
    width: 960,
    height: 700,
    show,
    title: 'Kick Resolver',
    backgroundColor: '#050505',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'kick-resolver',
    },
  });

  try {
    await withTimeout(
      resolverWindow.loadURL(`${KICK_ORIGIN}/${encodeURIComponent(normalizedChannel)}`),
      timeoutMs,
      'Kick page load timed out.',
    );

    const payload = await withTimeout(
      resolverWindow.webContents.executeJavaScript(
        buildKickChannelFetchScript(normalizedChannel),
        true,
      ),
      timeoutMs,
      'Kick browser resolver timed out.',
    );

    return normalizeResolvedKickPayload(normalizedChannel, payload);
  } finally {
    if (!resolverWindow.isDestroyed()) {
      resolverWindow.close();
    }
  }
};

const resolveKickChannelWithBrowserFallback = async ({
  channel,
  BrowserWindow,
  fetchImpl = fetch,
  show = false,
  timeoutMs = DEFAULT_BROWSER_TIMEOUT_MS,
} = {}) => {
  try {
    return await resolveKickChannel({ channel, fetchImpl });
  } catch (httpError) {
    try {
      return await resolveKickChannelInBrowser({
        channel,
        BrowserWindow,
        show,
        timeoutMs,
      });
    } catch (browserError) {
      throw new Error(
        `Kick resolver failed. HTTP: ${httpError.message}. Browser: ${browserError.message}`,
      );
    }
  }
};

const buildKickChannelFetchScript = (channel) => {
  const endpoint = `${KICK_ORIGIN}/api/v2/channels/${encodeURIComponent(channel)}`;

  return `
    (async () => {
      const response = await fetch(${JSON.stringify(endpoint)}, {
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' }
      });
      const payload = await response.json().catch(() => undefined);

      if (!response.ok) {
        throw new Error('Kick browser request failed with status ' + response.status + '.');
      }

      return payload;
    })();
  `;
};

const normalizeResolvedKickPayload = (channel, payload) => {
  const chatroomId = normalizeRequiredId(payload?.chatroom?.id, 'chatroom.id');

  return {
    channel,
    channelId: normalizeOptionalId(payload?.id),
    chatroomId,
  };
};

const withTimeout = async (promise, timeoutMs, message) => {
  let timeout;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeRequiredId = (value, fieldName) => {
  const normalized = normalizeOptionalId(value);

  if (!normalized) {
    throw new TypeError(`Kick ${fieldName} must be present.`);
  }

  return normalized;
};

const normalizeOptionalId = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return String(value);
};

module.exports = {
  buildKickChannelFetchScript,
  normalizeResolvedKickPayload,
  resolveKickChannelInBrowser,
  resolveKickChannelWithBrowserFallback,
};
