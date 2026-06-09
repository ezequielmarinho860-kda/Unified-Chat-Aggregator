(() => {
  const elements = {
    configForm: document.querySelector('[data-config-form]'),
    configMessage: document.querySelector('[data-config-message]'),
    form: document.querySelector('[data-login-form]'),
    loginMessage: document.querySelector('[data-login-message]'),
    logoutButton: document.querySelector('[data-logout-button]'),
    sessionLabel: document.querySelector('[data-session-label]'),
    sessionPanel: document.querySelector('[data-session-panel]'),
    sessionState: document.querySelector('[data-session-state]'),
  };

  const setSessionState = (state, label) => {
    if (elements.sessionState) {
      elements.sessionState.dataset.sessionState = state;
    }

    if (elements.sessionLabel) {
      elements.sessionLabel.textContent = label;
    }
  };

  const renderSession = (session) => {
    const authenticated = Boolean(session?.authenticated);

    elements.form.hidden = authenticated;
    elements.configForm.hidden = !authenticated;
    elements.sessionPanel.hidden = !authenticated;
    setSessionState(authenticated ? 'authenticated' : 'anonymous', authenticated ? 'Signed in' : 'Signed out');

    if (authenticated) {
      void loadConfig();
    }
  };

  const requestJson = async (path, options = {}) => {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Admin request failed with ${response.status}.`);
    }

    return payload;
  };

  const loadSession = async () => {
    setSessionState('loading', 'Checking session');

    try {
      renderSession(await requestJson('/api/admin/session'));
    } catch (error) {
      renderSession({ authenticated: false });
      showLoginMessage(error.message);
    }
  };

  const showLoginMessage = (message = '') => {
    elements.loginMessage.textContent = message;
  };

  const showConfigMessage = (message = '') => {
    elements.configMessage.textContent = message;
  };

  const loadConfig = async () => {
    showConfigMessage('');

    try {
      renderConfig(await requestJson('/api/admin/config'));
    } catch (error) {
      showConfigMessage(error.message);
    }
  };

  const renderConfig = (config) => {
    setField('viewer.title', config.viewer?.title ?? '');
    setField('viewer.theme', config.viewer?.theme ?? 'dark');
    setChecked('viewer.showExternalChats', config.viewer?.showExternalChats !== false);

    for (const platform of ['twitch', 'kick']) {
      for (const index of [0, 1]) {
        const source = config.sources?.[platform]?.[index] ?? {};

        setChecked(`sources.${platform}.${index}.enabled`, Boolean(source.enabled));
        setField(`sources.${platform}.${index}.channel`, source.channel ?? '');
      }
    }

    for (const index of [0, 1]) {
      const source = config.sources?.x?.[index] ?? {};

      setChecked(`sources.x.${index}.enabled`, Boolean(source.enabled));
      setField(`sources.x.${index}.liveUrl`, source.liveUrl ?? '');
    }
  };

  const readConfigForm = () => ({
    sources: {
      kick: readChannelSources('kick'),
      twitch: readChannelSources('twitch'),
      x: readLiveUrlSources(),
    },
    viewer: {
      showExternalChats: getChecked('viewer.showExternalChats'),
      theme: getField('viewer.theme') || 'dark',
      title: getField('viewer.title') || 'Unified Chat Aggregator',
    },
  });

  const readChannelSources = (platform) =>
    [0, 1].map((index) => ({
      channel: getField(`sources.${platform}.${index}.channel`),
      enabled: getChecked(`sources.${platform}.${index}.enabled`),
    }));

  const readLiveUrlSources = () =>
    [0, 1].map((index) => ({
      enabled: getChecked(`sources.x.${index}.enabled`),
      liveUrl: getField(`sources.x.${index}.liveUrl`),
    }));

  const validateConfig = (config) => {
    for (const platform of ['twitch', 'kick']) {
      for (const source of config.sources[platform]) {
        if (source.enabled && !source.channel) {
          throw new Error(`${platform} source needs a channel.`);
        }
      }
    }

    for (const source of config.sources.x) {
      if (source.enabled && !source.liveUrl) {
        throw new Error('X source needs a live URL or handle.');
      }
    }
  };

  const getField = (name) => elements.configForm.elements[name]?.value.trim() ?? '';

  const setField = (name, value) => {
    elements.configForm.elements[name].value = value;
  };

  const getChecked = (name) => Boolean(elements.configForm.elements[name]?.checked);

  const setChecked = (name, value) => {
    elements.configForm.elements[name].checked = Boolean(value);
  };

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showLoginMessage('');

    const formData = new FormData(elements.form);
    const token = String(formData.get('token') ?? '');

    try {
      renderSession(await requestJson('/api/admin/login', {
        body: { token },
        method: 'POST',
      }));
      elements.form.reset();
    } catch (error) {
      renderSession({ authenticated: false });
      showLoginMessage(error.message);
    }
  });

  elements.logoutButton.addEventListener('click', async () => {
    setSessionState('loading', 'Signing out');

    try {
      renderSession(await requestJson('/api/admin/logout', { method: 'POST' }));
    } catch (error) {
      showLoginMessage(error.message);
      await loadSession();
    }
  });

  elements.configForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showConfigMessage('');

    try {
      const config = readConfigForm();

      validateConfig(config);
      renderConfig(await requestJson('/api/admin/config', {
        body: config,
        method: 'PUT',
      }));
      showConfigMessage('Saved.');
    } catch (error) {
      showConfigMessage(error.message);
    }
  });

  void loadSession();
})();
