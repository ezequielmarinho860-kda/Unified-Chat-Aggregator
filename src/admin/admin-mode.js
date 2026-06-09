(() => {
  const elements = {
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
    elements.sessionPanel.hidden = !authenticated;
    setSessionState(authenticated ? 'authenticated' : 'anonymous', authenticated ? 'Signed in' : 'Signed out');
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

  void loadSession();
})();
