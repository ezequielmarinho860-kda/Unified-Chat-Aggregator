(() => {
  const reconnectBaseMs = 1_000;
  const reconnectMaxMs = 10_000;
  const transport = window.ViewerTransports.createDefaultViewerTransportClient({ clientType: 'overlay' });
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

    if (event.type === 'chat.message') {
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

    renderMessages();
  };

  const renderMessages = () => {
    chatElement.replaceChildren(...state.messages.map(createMessageElement));
  };

  const createMessageElement = (message) => {
    const article = document.createElement('article');
    const meta = document.createElement('div');
    const author = createAuthorElement(message);
    const reply = createReplyElement(message.reply);
    const text = document.createElement('p');

    article.className = 'overlay-message';
    article.dataset.platform = message.source?.platform ?? 'unknown';
    meta.className = 'overlay-meta';
    text.className = 'overlay-text';
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
    if (reply) {
      article.insertBefore(reply, text);
    }
    return article;
  };

  const createAuthorElement = (message) => {
    const profileUrl = getXAuthorProfileUrl(message);
    const author = profileUrl ? document.createElement('a') : document.createElement('strong');
    const authorName = message.author?.name ?? 'Unknown';

    author.className = profileUrl
      ? 'overlay-author overlay-author-link'
      : 'overlay-author';
    author.textContent = authorName;

    if (profileUrl) {
      author.href = profileUrl;
      author.target = '_blank';
      author.rel = 'noopener noreferrer';
      author.title = `Open ${authorName}'s X profile`;
    }

    return author;
  };

  const getXAuthorProfileUrl = (message = {}) =>
    message.source?.platform === 'x'
      ? normalizeXProfileUrl(message.author?.profileUrl)
      : undefined;

  const normalizeXProfileUrl = (value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return undefined;
    }

    try {
      const url = new URL(value);

      if (
        url.protocol !== 'https:' ||
        !['x.com', 'twitter.com'].includes(url.hostname.toLowerCase()) ||
        !/^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname) ||
        url.search ||
        url.hash
      ) {
        return undefined;
      }

      return url.toString().replace(/\/$/, '');
    } catch {
      return undefined;
    }
  };

  const createReplyElement = (reply) => {
    if (!reply) {
      return undefined;
    }

    const element = document.createElement('p');
    const target = reply.username ? `@${reply.username}` : reply.authorName;
    const hasTarget = Boolean(target);

    element.className = 'overlay-reply';
    element.textContent = hasTarget ? 'Replying to ' : 'Replying ';

    if (hasTarget) {
      element.append(document.createTextNode(target));
    }

    if (reply.text) {
      element.append(document.createTextNode(hasTarget ? `: ${reply.text}` : ` ${reply.text}`));
    }

    return element;
  };

  const createPlatformElement = (platform = 'unknown') => {
    const element = document.createElement('span');

    element.className = 'overlay-platform';

    element.append(document.createTextNode(platformLabels[platform] ?? platform));
    return element;
  };

  const createSourceElement = (source = {}) => {
    const label = source.channelLabel ?? source.broadcasterName ?? source.sourceId;

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

  void start();
})();
