(() => {
  const DEFAULT_MAX_MESSAGES = 8;
  const MAX_ALLOWED_MESSAGES = 50;
  const reconnectBaseMs = 1_000;
  const reconnectMaxMs = 10_000;
  const transport = window.ViewerTransports.createDefaultViewerTransportClient();
  const chatElement = document.querySelector('[data-overlay-chat]');
  const state = {
    eventConnection: undefined,
    messages: [],
    messageKeys: new Set(),
    reconnectAttempt: 0,
    reconnectTimer: undefined,
  };
  const platformLabels = {
    kick: 'Kick',
    twitch: 'Twitch',
    x: 'X',
  };
  const maxMessages = getIntegerOption('maxMessages', DEFAULT_MAX_MESSAGES, 1, MAX_ALLOWED_MESSAGES);

  const start = async () => {
    try {
      await transport.loadSnapshot();
      connectEvents();
    } catch {
      scheduleReconnect();
    }
  };

  const connectEvents = () => {
    const previousEventConnection = state.eventConnection;

    state.eventConnection = undefined;
    previousEventConnection?.close();

    const eventConnection = transport.connectEvents({
      onClose: () => {
        if (state.eventConnection !== eventConnection) {
          return;
        }

        scheduleReconnect();
      },
      onError: scheduleReconnect,
      onEvent: applyEvent,
      onOpen: () => {
        clearReconnectTimer();
        state.reconnectAttempt = 0;
      },
    });

    state.eventConnection = eventConnection;
  };

  const scheduleReconnect = () => {
    if (state.reconnectTimer !== undefined) {
      return;
    }

    const delay = Math.min(reconnectBaseMs * 2 ** state.reconnectAttempt, reconnectMaxMs);

    state.reconnectAttempt += 1;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = undefined;
      void start();
    }, delay);
  };

  const clearReconnectTimer = () => {
    if (state.reconnectTimer === undefined) {
      return;
    }

    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = undefined;
  };

  const applyEvent = (event) => {
    if (event?.protocolVersion !== '1') {
      return;
    }

    if (event.type === 'snapshot.replace') {
      clearMessages();
    } else if (event.type === 'chat.message') {
      addMessage(event.data);
    }
  };

  const addMessage = (message) => {
    const messageKey = getMessageKey(message);

    if (!messageKey || state.messageKeys.has(messageKey)) {
      return;
    }

    state.messages.push(message);
    state.messageKeys.add(messageKey);

    while (state.messages.length > maxMessages) {
      const removedMessage = state.messages.shift();
      state.messageKeys.delete(getMessageKey(removedMessage));
    }

    renderMessages();
  };

  const clearMessages = () => {
    state.messages = [];
    state.messageKeys = new Set();
    renderMessages();
  };

  const renderMessages = () => {
    chatElement.replaceChildren(...state.messages.map(createMessageElement));
  };

  const createMessageElement = (message) => {
    const article = document.createElement('article');
    const meta = document.createElement('div');
    const author = document.createElement('strong');
    const text = document.createElement('p');

    article.className = 'overlay-message';
    article.dataset.platform = message.source?.platform ?? 'unknown';
    meta.className = 'overlay-meta';
    author.className = 'overlay-author';
    text.className = 'overlay-text';
    author.textContent = message.author?.name ?? 'Unknown';
    text.append(...createFragmentElements(message));
    meta.append(
      ...[
        createPlatformElement(message.source?.platform),
        createSourceElement(message.source),
        author,
        ...createBadgeElements(message.author?.badges),
      ].filter(Boolean),
    );
    article.append(meta, text);
    return article;
  };

  const createPlatformElement = (platform = 'unknown') => {
    const element = document.createElement('span');

    element.className = 'overlay-platform';
    element.textContent = platformLabels[platform] ?? platform;
    return element;
  };

  const createSourceElement = (source = {}) => {
    const label = source.broadcasterName ?? source.channelLabel;

    if (!label) {
      return undefined;
    }

    const element = document.createElement('span');

    element.className = 'overlay-source';
    element.textContent = label;
    return element;
  };

  const createBadgeElements = (badges = []) =>
    badges.slice(0, 3).map((badge) => {
      const element = document.createElement('span');

      element.className = 'overlay-badge';
      element.title = badge.label ?? '';

      if (badge.imageUrl) {
        const image = document.createElement('img');

        image.src = badge.imageUrl;
        image.alt = badge.label ?? '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        element.append(image);
      } else {
        element.textContent = badge.label ?? badge.id ?? '';
      }

      return element;
    });

  const createFragmentElements = (message) => {
    const fragments = Array.isArray(message.fragments) ? message.fragments : [];

    if (fragments.length === 0) {
      return [document.createTextNode(message.text ?? '')];
    }

    return fragments.map((fragment) => {
      if (fragment.type === 'emote' && fragment.imageUrl) {
        const image = document.createElement('img');

        image.className = 'overlay-emote';
        image.src = fragment.imageUrl;
        image.alt = fragment.text ?? '';
        image.title = fragment.text ?? '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        return image;
      }

      return document.createTextNode(fragment.text ?? '');
    });
  };

  const getMessageKey = (message) =>
    message?.source?.sourceId && message?.id ? `${message.source.sourceId}:${message.id}` : undefined;

  function getIntegerOption(name, fallback, min, max) {
    const value = Number(new URLSearchParams(window.location.search).get(name));

    return Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
  }

  void start();
})();
