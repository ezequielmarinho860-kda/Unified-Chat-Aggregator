const VALID_STATES = new Set(['connected', 'connecting', 'error', 'stopped']);

const createBrowserBackendStatus = ({
  config = {},
  error,
  now = () => new Date(),
  state = 'stopped',
} = {}) =>
  compactObject({
    error: normalizeError(error),
    ingestConfigured: Boolean(config.ingestToken),
    mode: normalizeMode(config.mode),
    state: normalizeState(state),
    updatedAt: now().toISOString(),
    url: optionalString(config.url),
  });

const normalizeMode = (mode) =>
  mode === 'external' ? 'external' : 'embedded';

const normalizeState = (state) =>
  VALID_STATES.has(state) ? state : 'stopped';

const normalizeError = (error) => {
  if (!error) {
    return undefined;
  }

  if (typeof error === 'string') {
    return optionalString(error);
  }

  return optionalString(error.message);
};

const optionalString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));

module.exports = {
  createBrowserBackendStatus,
};
