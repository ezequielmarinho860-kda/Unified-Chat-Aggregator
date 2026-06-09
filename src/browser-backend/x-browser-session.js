const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createConnectorSource } = require('../source-identity');

const X_BROWSER_PROFILE_DIR_NAME = 'x-browser-profile';
const X_LOGIN_URL = 'https://x.com';

const openXBrowserLoginSession = ({
  browserDataDir,
  browserExecutablePath,
  env = process.env,
  liveUrl,
  spawnImpl = spawn,
} = {}) => {
  const profileDir = createXBrowserProfileDirForLiveUrl(browserDataDir, liveUrl);
  const executablePath = resolveBrowserExecutablePath({ browserExecutablePath, env });

  if (!profileDir) {
    throw new Error('X browser login requires a backend data directory.');
  }

  if (!executablePath) {
    throw new Error(
      'Chrome or Edge was not found. Set BROWSER_BACKEND_X_BROWSER_PATH to the browser executable.',
    );
  }

  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawnImpl(executablePath, [
    `--user-data-dir=${profileDir}`,
    X_LOGIN_URL,
  ], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref?.();

  return {
    opened: true,
    profileDir,
    url: X_LOGIN_URL,
  };
};

const createXBrowserProfileDirForLiveUrl = (browserDataDir, liveUrl) => {
  const normalizedLiveUrl = normalizeXLiveUrlOrHandle(liveUrl);
  const source = createConnectorSource({ platform: 'x', liveUrl: normalizedLiveUrl });

  if (!source) {
    throw new TypeError('X source needs a live URL or handle.');
  }

  return createXBrowserProfileDir(browserDataDir, source.sourceId);
};

const normalizeXLiveUrlOrHandle = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('X source needs a live URL or handle.');
  }

  const trimmedValue = value.trim();
  const handle = trimmedValue.replace(/^[@#]+/, '');

  if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return trimmedValue;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    throw new TypeError('X source must be an X URL or handle.');
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();

  if (!['x.com', 'twitter.com'].includes(hostname)) {
    throw new TypeError('X source URL must use x.com or twitter.com.');
  }

  return parsedUrl.toString();
};

const createXBrowserProfileDir = (browserDataDir, sourceId) => {
  if (typeof browserDataDir !== 'string' || browserDataDir.trim().length === 0) {
    return undefined;
  }

  return path.join(browserDataDir, X_BROWSER_PROFILE_DIR_NAME, normalizeFilesystemKey(sourceId));
};

const resolveBrowserExecutablePath = ({ browserExecutablePath, env = process.env } = {}) => {
  const explicitPath = resolveExistingPath(browserExecutablePath);

  if (explicitPath) {
    return explicitPath;
  }

  const candidates = [
    env.BROWSER_BACKEND_X_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\EdgeCore\\msedge.exe',
  ];

  for (const candidate of candidates) {
    const resolved = resolveExistingPath(candidate);

    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};

const normalizeFilesystemKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';

const resolveExistingPath = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const candidate = value.trim();

  return fs.existsSync(candidate) ? candidate : undefined;
};

module.exports = {
  createXBrowserProfileDir,
  createXBrowserProfileDirForLiveUrl,
  openXBrowserLoginSession,
  resolveBrowserExecutablePath,
};
