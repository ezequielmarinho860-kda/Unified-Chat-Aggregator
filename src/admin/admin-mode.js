(() => {
  const elements = {
    configForm: document.querySelector('[data-config-form]'),
    configMessage: document.querySelector('[data-config-message]'),
    form: document.querySelector('[data-login-form]'),
    loginMessage: document.querySelector('[data-login-message]'),
    logoutButton: document.querySelector('[data-logout-button]'),
    moderatorForm: document.querySelector('[data-moderator-form]'),
    moderatorList: document.querySelector('[data-moderator-list]'),
    moderatorsMessage: document.querySelector('[data-moderators-message]'),
    moderatorsPanel: document.querySelector('[data-moderators-panel]'),
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
    elements.moderatorsPanel.hidden = !authenticated;
    elements.sessionPanel.hidden = !authenticated;
    setSessionState(authenticated ? 'authenticated' : 'anonymous', authenticated ? 'Signed in' : 'Signed out');

    if (authenticated) {
      void loadConfig();
      void loadModerators();
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

  const showModeratorsMessage = (message = '') => {
    elements.moderatorsMessage.textContent = message;
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

  const openXLogin = async (sourceIndex) => {
    showConfigMessage('');
    const liveUrl = getField(`sources.x.${sourceIndex}.liveUrl`);

    if (!liveUrl) {
      throw new Error('X source needs a live URL or handle.');
    }

    await requestJson('/api/admin/x/login', {
      body: { liveUrl },
      method: 'POST',
    });
    showConfigMessage('Chrome opened for X login. Sign in there, then close that Chrome window.');
  };

  const loadModerators = async () => {
    showModeratorsMessage('');

    try {
      renderModerators((await requestJson('/api/admin/moderators')).moderators ?? []);
    } catch (error) {
      showModeratorsMessage(error.message);
    }
  };

  const renderModerators = (moderators) => {
    if (!elements.moderatorList) {
      return;
    }

    if (moderators.length === 0) {
      elements.moderatorList.replaceChildren(createEmptyModeratorElement());
      return;
    }

    elements.moderatorList.replaceChildren(...moderators.map(createModeratorElement));
  };

  const createEmptyModeratorElement = () => {
    const empty = document.createElement('p');

    empty.className = 'empty-list';
    empty.textContent = 'No moderators configured yet.';
    return empty;
  };

  const createModeratorElement = (moderator) => {
    const row = document.createElement('div');
    const identity = document.createElement('div');
    const label = document.createElement('strong');
    const detail = document.createElement('span');
    const removeButton = document.createElement('button');

    row.className = 'moderator-row';
    identity.className = 'moderator-identity';
    label.textContent = moderator.nick || moderator.email || 'Moderator';
    detail.textContent = [moderator.email, moderator.nick].filter(Boolean).join(' / ');
    removeButton.className = 'secondary-button';
    removeButton.type = 'button';
    removeButton.dataset.removeModerator = moderator.id;
    removeButton.textContent = 'Remove';
    identity.append(label, detail);
    row.append(identity, removeButton);
    return row;
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

  elements.configForm.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('[data-x-login]');

    if (!button) {
      return;
    }

    try {
      await openXLogin(button.dataset.xLogin);
    } catch (error) {
      showConfigMessage(error.message);
    }
  });

  elements.moderatorForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showModeratorsMessage('');

    const email = elements.moderatorForm.elements.email.value.trim();
    const nick = elements.moderatorForm.elements.nick.value.trim();

    try {
      if (!email && !nick) {
        throw new Error('Moderator needs an email or nick.');
      }

      await requestJson('/api/admin/moderators', {
        body: { email, nick },
        method: 'POST',
      });
      elements.moderatorForm.reset();
      await loadModerators();
      showModeratorsMessage('Moderator saved.');
    } catch (error) {
      showModeratorsMessage(error.message);
    }
  });

  elements.moderatorList?.addEventListener('click', async (event) => {
    const target = typeof event.target?.closest === 'function'
      ? event.target
      : event.target?.parentElement;
    const button = target?.closest('[data-remove-moderator]');

    if (!button) {
      return;
    }

    showModeratorsMessage('');

    try {
      const result = await requestJson(`/api/admin/moderators/${encodeURIComponent(button.dataset.removeModerator)}`, {
        method: 'DELETE',
      });

      renderModerators(result.moderators ?? []);
      showModeratorsMessage(result.removed > 0 ? 'Moderator removed.' : 'Moderator was already removed.');
    } catch (error) {
      showModeratorsMessage(error.message);
    }
  });

  void loadSession();
})();
