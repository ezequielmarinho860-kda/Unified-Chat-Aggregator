(() => {
  const MAX_MESSAGES = 200;
  const CHAT_BOTTOM_TOLERANCE_PX = 120;
  const LOCAL_SESSION_STORAGE_KEY = 'uca.localChatSession';
  const reconnectBaseMs = 1_000;
  const reconnectMaxMs = 10_000;
  const transport = window.ViewerTransports.createDefaultViewerTransportClient();
  const filterPlatforms = ['twitch', 'kick', 'x', 'local'];
  function isPopoutPathname(pathname) {
    return pathname === '/popout' || pathname === '/popout/';
  }

  function detectViewerMode() {
    const params = new URLSearchParams(window.location.search);

    return isPopoutPathname(window.location.pathname) || params.get('mode') === 'popout'
      ? 'popout'
      : 'full';
  }

  const viewerMode = detectViewerMode();
  const state = {
    eventConnection: undefined,
    snapshot: undefined,
    reconnectAttempt: 0,
    messageCount: 0,
    messages: [],
    messageKeys: new Set(),
    selectedPlayerSourceId: undefined,
    renderedPlayerKey: undefined,
    chatPinnedToBottom: true,
    unseenMessageCount: 0,
    pendingRenderFrame: undefined,
    pendingStickToBottom: undefined,
    chatDomDirty: false,
    hasRenderedChat: false,
    activeChatPlatforms: new Set(filterPlatforms),
    localSession: undefined,
    localModerationCommands: [],
    pendingGoogleOAuth: undefined,
    pendingLocalRegistrationEmail: undefined,
    viewerMode,
  };
  const platformLabels = {
    twitch: 'Twitch',
    kick: 'Kick',
    local: 'Local',
    x: 'X',
    youtube: 'YouTube',
  };
  const platformSymbols = {
    kick: 'K',
    local: 'L',
    x: 'X',
  };
  const platformIconUrls = {
    twitch: '/viewer/assets/twitch-glitch.svg',
  };
  const elements = {
    title: document.querySelector('[data-viewer-title]'),
    connectionCard: document.querySelector('.connection-card'),
    connectionLabel: document.querySelector('[data-connection-label]'),
    connectionDetail: document.querySelector('[data-connection-detail]'),
    playerPanel: document.querySelector('[data-player-panel]'),
    viewerTotal: document.querySelector('[data-viewer-total]'),
    viewerUpdated: document.querySelector('[data-viewer-updated]'),
    sourceList: document.querySelector('[data-source-list]'),
    messageCount: document.querySelector('[data-message-count]'),
    chatList: document.querySelector('[data-chat-list]'),
    chatFilterButtons: document.querySelectorAll('[data-chat-platform-filter]'),
    clearChat: document.querySelector('[data-clear-chat]'),
    localAuthForm: document.querySelector('[data-local-auth-form]'),
    localChatStatus: document.querySelector('[data-local-chat-status]'),
    localChatSuggestions: document.querySelector('[data-local-chat-suggestions]'),
    localGoogleLogin: document.querySelector('[data-local-google-login]'),
    localLogout: document.querySelector('[data-local-logout]'),
    localMessageForm: document.querySelector('[data-local-message-form]'),
    localSessionLabel: document.querySelector('[data-local-session-label]'),
    localSessionPanel: document.querySelector('[data-local-session-panel]'),
    resumeChat: document.querySelector('[data-resume-chat]'),
  };
  const viewerCards = new Map(
    [...document.querySelectorAll('[data-viewer-card]')].map((card) => [
      card.dataset.viewerCard,
      card,
    ]),
  );
  const viewerCountElements = new Map(
    [...document.querySelectorAll('[data-viewer-platform-count]')].map((element) => [
      element.dataset.viewerPlatformCount,
      element,
    ]),
  );
  const CHAT_SCROLL_DEBUG_LIMIT = 80;

  document.body.dataset.viewerMode = state.viewerMode;

  const getChatScrollMetrics = () => {
    if (!elements.chatList) {
      return {};
    }

    const remaining =
      elements.chatList.scrollHeight - elements.chatList.scrollTop - elements.chatList.clientHeight;

    return {
      clientHeight: Math.round(elements.chatList.clientHeight),
      remaining: Math.round(remaining),
      scrollHeight: Math.round(elements.chatList.scrollHeight),
      scrollTop: Math.round(elements.chatList.scrollTop),
    };
  };

  const chatScrollDebug = (() => {
    let enabled = new URLSearchParams(window.location.search).has('debugChat');
    const entries = [];

    try {
      enabled = enabled || window.localStorage.getItem('chatScrollDebug') === '1';
    } catch {
      enabled = Boolean(enabled);
    }

    const api = {
      clear() {
        entries.length = 0;
      },
      disable() {
        enabled = false;
        try {
          window.localStorage.removeItem('chatScrollDebug');
        } catch {
          // localStorage can be unavailable in restricted browser contexts.
        }
      },
      dump() {
        const snapshot = api.getLog();

        console.table(snapshot);
        return snapshot;
      },
      enable() {
        enabled = true;
        try {
          window.localStorage.setItem('chatScrollDebug', '1');
        } catch {
          // localStorage can be unavailable in restricted browser contexts.
        }

        api.log('debug_enabled');
      },
      getLog() {
        return entries.map((entry) => formatChatScrollDebugEntry(entry));
      },
      log(event, details = {}) {
        if (!enabled) {
          return;
        }

        const entry = {
          at: new Date().toISOString(),
          chatPinnedToBottom: state.chatPinnedToBottom,
          event,
          metrics: getChatScrollMetrics(),
          unseenMessageCount: state.unseenMessageCount,
          ...details,
        };

        entries.push(entry);

        while (entries.length > CHAT_SCROLL_DEBUG_LIMIT) {
          entries.shift();
        }

        console.debug('[viewer-chat-scroll]', entry);
      },
    };

    window.__chatScrollDebug = api;
    window.chatScrollDebug = api;
    return api;
  })();

  const formatChatScrollDebugEntry = (entry) => ({
    at: entry.at,
    event: entry.event,
    from: entry.from,
    to: entry.to,
    reason: entry.reason,
    remaining: entry.metrics?.remaining,
    scrollTop: entry.metrics?.scrollTop,
    scrollHeight: entry.metrics?.scrollHeight,
    clientHeight: entry.metrics?.clientHeight,
    pinned: entry.chatPinnedToBottom,
    unseen: entry.unseenMessageCount,
    trusted: entry.isTrusted,
    messageKey: entry.messageKey,
    platform: entry.platform,
    sourceId: entry.sourceId,
    stick: entry.shouldStickToBottom ?? entry.stickToBottom,
  });

  const setChatPinnedToBottom = (nextPinnedToBottom, reason, details = {}) => {
    const normalizedPinnedToBottom = Boolean(nextPinnedToBottom);

    if (state.chatPinnedToBottom !== normalizedPinnedToBottom) {
      chatScrollDebug.log('pinned_change', {
        from: state.chatPinnedToBottom,
        reason,
        to: normalizedPinnedToBottom,
        ...details,
      });
    }

    state.chatPinnedToBottom = normalizedPinnedToBottom;
  };

  const setConnection = (connectionState, label, detail) => {
    elements.connectionCard.dataset.connectionState = connectionState;
    elements.connectionLabel.textContent = label;

    if (elements.connectionDetail) {
      elements.connectionDetail.textContent = detail;
    }
  };

  const start = async () => {
    try {
      restoreLocalSession();
      consumeGoogleOAuthRedirect();
      await verifyLocalSession();
      await refreshGoogleOAuthStatus();
      await refreshLocalModerationCommands();

      await loadSnapshot();
      connectEvents();
    } catch (error) {
      setConnection('error', 'Viewer unavailable', error.message);
      scheduleReconnect();
    }
  };

  const loadSnapshot = async () => {
    setConnection('loading', 'Loading snapshot', 'Fetching public viewer state.');
    applySnapshot(await transport.loadSnapshot());
  };

  const connectEvents = () => {
    const previousEventConnection = state.eventConnection;

    state.eventConnection = undefined;
    previousEventConnection?.close();
    setConnection('loading', 'Connecting realtime', 'Opening realtime stream.');

    const eventConnection = transport.connectEvents({
      onClose: () => {
        if (state.eventConnection !== eventConnection) {
          return;
        }

        setConnection('disconnected', 'Disconnected', 'Reconnecting with a fresh snapshot.');
        scheduleReconnect();
      },
      onError: () => {
        setConnection('error', 'Connection error', 'Realtime stream is unavailable.');
      },
      onEvent: applyEvent,
      onOpen: () => {
        state.reconnectAttempt = 0;
        setConnection('connected', 'Live connection', 'Receiving public realtime events.');
      },
    });

    state.eventConnection = eventConnection;
  };

  const scheduleReconnect = () => {
    const delay = Math.min(reconnectBaseMs * 2 ** state.reconnectAttempt, reconnectMaxMs);

    state.reconnectAttempt += 1;
    setTimeout(() => {
      void start();
    }, delay);
  };

  const applyEvent = (event) => {
    if (!event || event.protocolVersion !== '1') {
      return;
    }

    if (event.type === 'snapshot.replace') {
      state.messageCount = 0;
      state.messages = [];
      state.messageKeys = new Set();
      setChatPinnedToBottom(true, 'snapshot_replace');
      state.unseenMessageCount = 0;
      cancelScheduledRender();
      applySnapshot(event.data);
    } else if (event.type === 'source.status') {
      upsertStatus(event.data);
      scheduleRender();
    } else if (event.type === 'viewers.update') {
      state.snapshot = { ...state.snapshot, viewers: event.data };
      scheduleRender();
    } else if (event.type === 'manifest.update') {
      state.snapshot = { ...state.snapshot, manifest: event.data };
      scheduleRender();
    } else if (event.type === 'chat.message') {
      addChatMessage(event.data);
    }
  };

  const addChatMessage = (message) => {
    const messageKey = getMessageKey(message);
    const shouldStickToBottom = shouldAutoscrollChat();

    if (!messageKey || state.messageKeys.has(messageKey)) {
      return;
    }

    state.messageKeys.add(messageKey);
    state.messages.push(message);
    state.messageCount += 1;
    state.chatDomDirty = true;

    while (state.messages.length > MAX_MESSAGES) {
      const removedMessage = state.messages.shift();
      state.messageKeys.delete(getMessageKey(removedMessage));
    }

    if (!shouldStickToBottom) {
      setChatPinnedToBottom(false, 'chat_message_not_at_bottom', { messageKey });
      state.unseenMessageCount += 1;
      chatScrollDebug.log('message_buffered', {
        messageKey,
        platform: message.platform,
        shouldStickToBottom,
        sourceId: message.source?.sourceId,
      });
    }

    scheduleRender({ stickToBottom: shouldStickToBottom });
  };

  const getMessageKey = (message) =>
    message?.source?.sourceId && message?.id ? `${message.source.sourceId}:${message.id}` : undefined;

  const applySnapshot = (snapshot) => {
    state.snapshot = {
      protocolVersion: snapshot?.protocolVersion,
      generatedAt: snapshot?.generatedAt,
      manifest: snapshot?.manifest ?? {},
      statuses: Array.isArray(snapshot?.statuses) ? snapshot.statuses : [],
      viewers: snapshot?.viewers ?? { sources: [], total: 0 },
    };
    render({ stickToBottom: true, forceChatRender: true });
  };

  const upsertStatus = (status) => {
    const sourceId = status?.source?.sourceId;

    if (!sourceId) {
      return;
    }

    const statuses = [...(state.snapshot?.statuses ?? [])];
    const index = statuses.findIndex((existing) => existing.source?.sourceId === sourceId);

    if (index >= 0) {
      statuses[index] = status;
    } else {
      statuses.push(status);
    }

    state.snapshot = { ...state.snapshot, statuses };
  };

  const render = ({ stickToBottom = state.chatPinnedToBottom, forceChatRender = false } = {}) => {
    const snapshot = state.snapshot ?? {};
    const previousChatScrollTop = elements.chatList.scrollTop;
    const shouldStickToBottom = stickToBottom && shouldAutoscrollChat();
    const shouldRenderChat = forceChatRender || shouldStickToBottom || !state.hasRenderedChat;

    if (elements.title) {
      elements.title.textContent = snapshot.manifest?.title ?? 'Unified Chat Aggregator';
    }

    if (elements.viewerTotal) {
      elements.viewerTotal.textContent = formatNumber(snapshot.viewers?.total ?? 0);
    }

    if (elements.viewerUpdated) {
      elements.viewerUpdated.textContent = formatViewerUpdated(snapshot.viewers);
    }

    elements.messageCount.textContent = formatNumber(state.messageCount);
    renderPlayer(snapshot.manifest);
    renderViewerCards(snapshot.viewers);

    if (elements.sourceList) {
      elements.sourceList.replaceChildren(...createSourceElements(snapshot));
    }

    if (shouldRenderChat) {
      elements.chatList.replaceChildren(...createChatElements());
      state.chatDomDirty = false;
      state.hasRenderedChat = true;
    }

    if (shouldStickToBottom) {
      scrollChatToBottom();
    } else if (forceChatRender) {
      scrollChatToBottom();
    } else {
      setChatPinnedToBottom(false, 'render_preserve_scroll');
      elements.chatList.scrollTop = previousChatScrollTop;
    }

    updateResumeChatControl();
  };

  const scheduleRender = ({ stickToBottom = state.chatPinnedToBottom } = {}) => {
    const nextStickToBottom = Boolean(stickToBottom);

    state.pendingStickToBottom =
      state.pendingStickToBottom === undefined
        ? nextStickToBottom
        : state.pendingStickToBottom && nextStickToBottom;

    if (state.pendingRenderFrame !== undefined) {
      return;
    }

    state.pendingRenderFrame = window.requestAnimationFrame(() => {
      const pendingStickToBottom = state.pendingStickToBottom;

      state.pendingRenderFrame = undefined;
      state.pendingStickToBottom = undefined;
      render({ stickToBottom: pendingStickToBottom });
    });
  };

  const flushScheduledRender = ({
    stickToBottom = state.chatPinnedToBottom,
    forceChatRender = false,
  } = {}) => {
    cancelScheduledRender();

    render({ stickToBottom, forceChatRender });
  };

  const cancelScheduledRender = () => {
    if (state.pendingRenderFrame === undefined) {
      return;
    }

    window.cancelAnimationFrame(state.pendingRenderFrame);
    state.pendingRenderFrame = undefined;
    state.pendingStickToBottom = undefined;
  };

  const createSourceElements = (snapshot) => {
    const rows = new Map();

    for (const source of snapshot.manifest?.sources ?? []) {
      rows.set(source.sourceId, { source });
    }

    for (const status of snapshot.statuses ?? []) {
      mergeSourceRow(rows, status.source, { status });
    }

    for (const viewer of snapshot.viewers?.sources ?? []) {
      mergeSourceRow(rows, viewer.source, { viewer });
    }

    return rows.size > 0 ? [...rows.values()].map(createSourceElement) : [createEmptySourceElement()];
  };

  const renderViewerCards = (viewers = {}) => {
    const platformRows = new Map(
      ['twitch', 'kick', 'x'].map((platform) => [
        platform,
        { count: 0, sources: [], state: 'unavailable' },
      ]),
    );

    for (const viewer of viewers.sources ?? []) {
      const platform = viewer.source?.platform;
      const row = platformRows.get(platform);

      if (!row) {
        continue;
      }

      row.sources.push(viewer);

      if (viewer.state === 'available') {
        row.state = 'available';
        row.count += viewer.count ?? 0;
      } else if (row.state !== 'available') {
        row.state = viewer.state ?? 'unavailable';
      }
    }

    for (const [platform, row] of platformRows) {
      updateViewerCard(
        platform,
        row.state,
        row.state === 'available' ? formatNumber(row.count) : '--',
        createViewerCardTooltip(platform, row, viewers),
      );
    }

    updateViewerCard(
      'total',
      'available',
      formatNumber(viewers.total ?? 0),
      createViewerCardTooltip('total', { count: viewers.total ?? 0, sources: viewers.sources ?? [], state: 'available' }),
    );
  };

  const updateViewerCard = (platform, viewerState, count, title) => {
    const card = viewerCards.get(platform);
    const countElement = viewerCountElements.get(platform);

    if (card) {
      card.dataset.viewerState = viewerState;
      card.title = title ?? '';
      card.setAttribute('aria-label', title ?? '');
    }

    if (countElement) {
      countElement.textContent = count;
    }
  };

  const renderPlayer = (manifest = {}) => {
    const playerSources = getPlayerSources(manifest);
    const playerSource = getSelectedPlayerSource(playerSources);
    const playerAdapter = getPlayerAdapter(playerSource);
    const playerKey = playerSource
      ? `${playerSource.sourceId}:${playerAdapter?.provider ?? 'external'}:${playerSource.watchUrl ?? ''}:${playerSource.player?.channel ?? ''}`
      : 'fallback';

    if (state.renderedPlayerKey === playerKey) {
      return;
    }

    state.renderedPlayerKey = playerKey;
    elements.playerPanel.replaceChildren(
      ...createPlayerElements({
        playerAdapter,
        playerSource,
        playerSources,
      }),
    );
  };

  const getPlayerSources = (manifest = {}) =>
    (manifest.sources ?? []).filter((source) => getPlayerAdapter(source) || source.watchUrl);

  const getSelectedPlayerSource = (playerSources) => {
    const selectedSource = playerSources.find(
      (source) => source.sourceId === state.selectedPlayerSourceId,
    );

    if (selectedSource) {
      return selectedSource;
    }

    const embeddedSource = playerSources.find((source) => getPlayerAdapter(source));
    const fallbackSource = embeddedSource ?? playerSources[0];

    state.selectedPlayerSourceId = fallbackSource?.sourceId;
    return fallbackSource;
  };

  const createPlayerElements = ({ playerAdapter, playerSource, playerSources }) => {
    if (!playerSource) {
      return [createPlayerFallback('No public player or watch link is configured yet.')];
    }

    return [
      createPanelKicker('Player'),
      createPlayerSourceSelector(playerSources),
      ...(playerAdapter
        ? playerAdapter.createElements(playerSource)
        : createExternalPlayerFallbackElements(playerSource)),
    ];
  };

  const createPlayerFallback = (message) => {
    const fallback = document.createElement('div');

    fallback.className = 'empty-state';
    fallback.textContent = message;
    return fallback;
  };

  const createPlayerSourceSelector = (playerSources) => {
    const selector = document.createElement('div');

    selector.className = 'player-source-selector';

    if (playerSources.length <= 1) {
      return selector;
    }

    for (const source of playerSources) {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'player-source-button';
      button.textContent = formatSourceLabel(source);
      button.setAttribute('aria-pressed', String(source.sourceId === state.selectedPlayerSourceId));
      button.addEventListener('click', () => {
        state.selectedPlayerSourceId = source.sourceId;
        state.renderedPlayerKey = undefined;
        renderPlayer(state.snapshot?.manifest);
      });
      selector.append(button);
    }

    return selector;
  };

  const createTwitchPlayerElements = (source) => {
    const title = document.createElement('h2');
    const frameWrap = document.createElement('div');
    const frame = document.createElement('iframe');
    const fallback = document.createElement('p');
    const link = createExternalPlayerLink(source, 'Open on Twitch');

    title.textContent = formatSourceLabel(source);
    frameWrap.className = 'player-frame-wrap';
    frame.className = 'player-frame';
    frame.src = createTwitchPlayerUrl(source.player.channel);
    frame.title = `Twitch player for ${formatSourceLabel(source)}`;
    frame.allow = 'autoplay; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    fallback.className = 'player-fallback';
    fallback.append('If the embedded player is unavailable, ', link, '.');
    frameWrap.append(frame);

    return [title, frameWrap, fallback];
  };

  const createExternalPlayerFallbackElements = (source) => {
    const title = document.createElement('h2');
    const fallback = document.createElement('div');
    const link = createExternalPlayerLink(source, `Open on ${formatPlatform(source.platform)}`);

    title.textContent = formatSourceLabel(source);
    fallback.className = 'empty-state player-external-fallback';
    fallback.append('No approved embed is available for this platform yet. ', link);
    return [title, fallback];
  };

  const createExternalPlayerLink = (source, label) => {
    const link = document.createElement('a');

    link.href = source.watchUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = label;
    return link;
  };

  const createPanelKicker = (text) => {
    const kicker = document.createElement('p');

    kicker.className = 'panel-kicker';
    kicker.textContent = text;
    return kicker;
  };

  const createTwitchPlayerUrl = (channel) => {
    const url = new URL('https://player.twitch.tv/');

    url.searchParams.set('channel', channel);
    url.searchParams.set('parent', window.location.hostname);
    url.searchParams.set('muted', 'true');
    return url.toString();
  };

  const PLAYER_ADAPTERS = [
    {
      provider: 'twitch',
      supports: (source) => source?.player?.provider === 'twitch' && source.player.channel,
      createElements: createTwitchPlayerElements,
    },
  ];

  const getPlayerAdapter = (source) =>
    PLAYER_ADAPTERS.find((adapter) => adapter.supports(source));

  const formatSourceLabel = (source = {}) =>
    source.channelLabel ?? source.broadcasterName ?? source.sourceId ?? formatPlatform(source.platform);

  const formatPlatform = (platform = 'platform') =>
    platform === 'x' ? 'X' : `${platform.slice(0, 1).toUpperCase()}${platform.slice(1)}`;

  const mergeSourceRow = (rows, source, patch) => {
    if (source?.sourceId) {
      rows.set(source.sourceId, { ...rows.get(source.sourceId), source, ...patch });
    }
  };

  const createSourceElement = ({ source, status, viewer }) => {
    const row = document.createElement('div');
    const label = source.channelLabel ?? source.broadcasterName ?? source.sourceId;
    const viewerDisplay = getViewerDisplay(viewer);

    row.className = `source-row source-row-${viewerDisplay.state}`;
    row.innerHTML = [
      '<div class="source-main">',
      '<div class="source-name"></div>',
      '<div class="source-meta"></div>',
      '<div class="source-updated"></div>',
      '</div>',
      '<div class="source-viewers">',
      '<strong class="source-viewer-count"></strong>',
      '<span class="source-viewer-state"></span>',
      '<span class="source-state"></span>',
      '</div>',
    ].join('');
    row.querySelector('.source-name').textContent = source.platform;
    row.querySelector('.source-meta').textContent = label;
    row.querySelector('.source-updated').textContent = formatViewerSourceUpdated(viewer);
    row.querySelector('.source-viewer-count').textContent = viewerDisplay.count;
    row.querySelector('.source-viewer-state').textContent = viewerDisplay.label;
    row.querySelector('.source-state').textContent = `connector: ${status?.state ?? 'idle'}`;
    return row;
  };

  const createEmptySourceElement = () => {
    const row = document.createElement('div');

    row.className = 'empty-state';
    row.textContent = 'No public sources are enabled yet.';
    return row;
  };

  const createChatElements = () => {
    const visibleMessages = getVisibleChatMessages();

    return visibleMessages.length > 0
      ? visibleMessages.map(createMessageElement)
      : [createEmptyChatElement()];
  };

  const getVisibleChatMessages = () =>
    areAllChatPlatformsActive()
      ? state.messages
      : state.messages.filter((message) => state.activeChatPlatforms.has(getMessagePlatform(message)));

  const getMessagePlatform = (message = {}) =>
    message.source?.platform ?? message.platform ?? 'unknown';

  const areAllChatPlatformsActive = () => state.activeChatPlatforms.size === filterPlatforms.length;

  const formatActiveChatPlatformLabel = () =>
    [...state.activeChatPlatforms]
      .map((platform) => platformLabels[platform] ?? platform)
      .join(' + ');

  const createMessageElement = (message) => {
    const article = document.createElement('article');
    const avatar = shouldRenderAuthorAvatar(message) ? createAvatarElement(message) : undefined;
    const body = document.createElement('div');
    const meta = document.createElement('div');
    const platform = createPlatformBadge(getMessagePlatform(message));
    const source = createMessageSource(message.source);
    const author = document.createElement('strong');
    const time = document.createElement('time');
    const content = document.createElement('p');

    article.className = 'message';
    article.dataset.platform = getMessagePlatform(message);
    body.className = 'message__content';
    meta.className = 'message__metadata';
    author.className = 'message__author';
    time.className = 'message__time';
    content.className = 'message__text';

    author.textContent = message.author?.name ?? 'Unknown';
    time.dateTime = message.timestamp ?? '';
    time.textContent = formatTime(message.timestamp);

    meta.append(
      ...[
        platform,
        source,
        author,
        ...createBadgeElements(message.author?.badges),
        time,
      ].filter(Boolean),
    );
    content.append(...createFragmentElements(message));
    body.append(meta, content);
    article.append(...[avatar, body].filter(Boolean));
    return article;
  };

  const shouldRenderAuthorAvatar = (message) =>
    !['kick', 'local', 'twitch'].includes(getMessagePlatform(message));

  const createMessageSource = (source = {}) => {
    const label = source.broadcasterName ?? source.channelLabel;

    if (!label) {
      return undefined;
    }

    const element = document.createElement('span');

    element.className = 'message__source';
    element.textContent = label;
    element.title = `Stream source: ${label}`;
    return element;
  };

  const createPlatformBadge = (platform = 'unknown') => {
    const badge = document.createElement('span');
    const label = document.createElement('span');

    badge.className = `message__badge message__badge--${platform}`;
    label.textContent = platformLabels[platform] ?? platform;

    if (platformIconUrls[platform]) {
      const icon = document.createElement('img');

      icon.className = 'message__badge-symbol message__badge-symbol--image';
      icon.src = platformIconUrls[platform];
      icon.alt = '';
      icon.referrerPolicy = 'no-referrer';
      icon.addEventListener('error', () => {
        icon.replaceWith(createPlatformSymbol(platform));
      });
      badge.append(icon);
    } else if (platformSymbols[platform]) {
      badge.append(createPlatformSymbol(platform));
    }

    badge.append(label);
    return badge;
  };

  const createPlatformSymbol = (platform) => {
    const symbol = document.createElement('span');

    symbol.className = 'message__badge-symbol';
    symbol.textContent = platformSymbols[platform] ?? platform.charAt(0).toUpperCase();
    return symbol;
  };

  const createAvatarElement = (message) => {
    const avatarUrl = message.avatarUrl ?? message.author?.avatarUrl;
    const fallback = createAvatarFallback(message);

    if (avatarUrl) {
      const image = document.createElement('img');

      image.className = 'message__avatar';
      image.src = avatarUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => image.replaceWith(fallback));
      return image;
    }

    return fallback;
  };

  const createAvatarFallback = (message) => {
    const fallback = document.createElement('span');

    fallback.className = 'message__avatar message__avatar--fallback';
    fallback.textContent = (message.author?.name ?? '?').slice(0, 1).toUpperCase();
    return fallback;
  };

  const createBadgeElements = (badges = []) =>
    badges.map((badge) => {
      const element = document.createElement('span');

      element.className = `author-badge author-badge--${badge.id}`;
      element.title = badge.label;

      if (badge.imageUrl) {
        const image = document.createElement('img');

        element.classList.add('author-badge--image');
        image.className = 'author-badge__image';
        image.src = badge.imageUrl;
        image.alt = badge.label;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        element.append(image);
      } else {
        element.textContent = badge.label;
      }

      return element;
    });

  const createFragmentElements = (message) => {
    const fragments = Array.isArray(message.fragments) ? message.fragments : [];

    if (fragments.length === 0) {
      return createTextWithMentions(message.text ?? '');
    }

    return fragments.flatMap((fragment) => {
      if (fragment.type === 'mention') {
        return [createMentionElement(fragment.text)];
      }

      if (fragment.type === 'emote' && fragment.imageUrl) {
        const image = document.createElement('img');

        image.className = 'chat-emote';
        image.addEventListener('load', maintainChatBottomAfterMediaLoad, { once: true });
        if (isExtensionEmote(fragment)) {
          image.classList.add('chat-emote--extension');
          image.addEventListener('load', () => markLargeExtensionEmote(image), { once: true });
        }
        image.src = fragment.imageUrl;
        image.alt = fragment.text;
        image.title = fragment.text;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        return [image];
      }

      return createTextWithMentions(fragment.text ?? '');
    });
  };

  const createTextWithMentions = (text) =>
    splitTextByVisibleMention(text).map((part) =>
      part.type === 'mention'
        ? createMentionElement(part.text)
        : document.createTextNode(part.text));

  const splitTextByVisibleMention = (text = '') => {
    const parts = [];
    const mentionPattern = /(^|[^\w])(@[A-Za-z0-9_]{2,24})\b/g;
    let cursor = 0;
    let match;

    while ((match = mentionPattern.exec(text)) !== null) {
      const mentionStart = match.index + match[1].length;

      if (mentionStart > cursor) {
        parts.push({ type: 'text', text: text.slice(cursor, mentionStart) });
      }

      parts.push({ type: 'mention', text: match[2] });
      cursor = mentionStart + match[2].length;
    }

    if (cursor < text.length) {
      parts.push({ type: 'text', text: text.slice(cursor) });
    }

    return parts.length > 0 ? parts : [{ type: 'text', text }];
  };

  const createMentionElement = (text) => {
    const mention = document.createElement('span');

    mention.className = 'message__mention';
    mention.textContent = text;
    return mention;
  };

  const maintainChatBottomAfterMediaLoad = () => {
    if (!state.chatPinnedToBottom) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!state.chatPinnedToBottom) {
        return;
      }

      scrollChatToBottom();
    });
  };

  const markLargeExtensionEmote = (image) => {
    const { naturalHeight, naturalWidth } = image;

    if (naturalHeight > 72 || naturalWidth > 144 || naturalHeight > naturalWidth * 1.25) {
      image.classList.add('chat-emote--large');
    }
  };

  const isExtensionEmote = (fragment) => {
    const id = String(fragment.id ?? '');
    const imageUrl = String(fragment.imageUrl ?? '');

    return (
      id.startsWith('bttv:') ||
      id.startsWith('7tv:') ||
      imageUrl.includes('cdn.betterttv.net') ||
      imageUrl.includes('cdn.7tv.app')
    );
  };

  const createEmptyChatElement = () => {
    const empty = document.createElement('div');
    const filterLabel = formatActiveChatPlatformLabel();

    empty.className = 'empty-state';
    empty.dataset.chatEmpty = '';
    empty.textContent =
      areAllChatPlatformsActive()
        ? 'Waiting for new public chat messages from the realtime stream.'
        : `No ${filterLabel} messages in the current chat buffer.`;
    return empty;
  };

  const restoreLocalSession = () => {
    try {
      const rawSession = window.localStorage.getItem(LOCAL_SESSION_STORAGE_KEY);

      state.localSession = rawSession ? JSON.parse(rawSession) : undefined;
    } catch {
      state.localSession = undefined;
    }

    renderLocalChatControls();
  };

  const verifyLocalSession = async () => {
    if (!state.localSession?.token) {
      renderLocalChatControls();
      return;
    }

    try {
      const { user } = await transport.getLocalSession(state.localSession.token);

      setLocalSession({ token: state.localSession.token, user });
    } catch {
      clearLocalSession();
      setLocalChatStatus('Local chat login expired.');
    }
  };

  const consumeGoogleOAuthRedirect = () => {
    if (!window.location.hash) {
      return;
    }

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('localToken');
    const rawUser = params.get('localUser');
    const ticket = params.get('oauthTicket');

    if (token && rawUser) {
      try {
        setLocalSession({ token, user: JSON.parse(rawUser) });
        setLocalChatStatus('Logged in with Google.');
      } catch (error) {
        setLocalChatStatus(error.message);
      } finally {
        clearGoogleOAuthHash();
      }

      return;
    }

    if (ticket) {
      const email = params.get('oauthEmail') ?? '';

      state.pendingGoogleOAuth = {
        email,
        name: params.get('oauthName') ?? '',
        ticket,
      };
      setLocalChatStatus(`Google verified ${email}. Choose a nick and click Join.`);
      clearGoogleOAuthHash();
      renderLocalChatControls();
    }
  };

  const clearGoogleOAuthHash = () => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };

  const refreshGoogleOAuthStatus = async () => {
    if (!elements.localGoogleLogin || typeof transport.getGoogleOAuthStatus !== 'function') {
      return;
    }

    try {
      const { enabled } = await transport.getGoogleOAuthStatus();

      elements.localGoogleLogin.hidden = !enabled;
    } catch {
      elements.localGoogleLogin.hidden = true;
    }
  };

  const refreshLocalModerationCommands = async () => {
    if (typeof transport.getLocalModerationCommands !== 'function') {
      return;
    }

    try {
      const { commands } = await transport.getLocalModerationCommands();

      state.localModerationCommands = Array.isArray(commands) ? commands : [];
    } catch {
      state.localModerationCommands = [];
    }
  };

  const isLocalModerator = () =>
    ['host', 'moderator'].includes(state.localSession?.user?.role);

  const updateLocalChatSuggestions = () => {
    if (!elements.localChatSuggestions || !elements.localMessageForm || !state.localSession?.token) {
      clearLocalChatSuggestions();
      return;
    }

    const input = elements.localMessageForm.elements.namedItem('text');
    const token = getActiveTextToken(input);

    if (!token) {
      clearLocalChatSuggestions();
      return;
    }

    if (token.value.startsWith('/')) {
      renderLocalCommandSuggestions(input, token);
      return;
    }

    if (token.value.startsWith('@')) {
      renderLocalMentionSuggestions(input, token);
      return;
    }

    clearLocalChatSuggestions();
  };

  const renderLocalCommandSuggestions = (input, token) => {
    if (!isLocalModerator()) {
      clearLocalChatSuggestions();
      return;
    }

    const query = token.value.toLowerCase();
    const commands = state.localModerationCommands
      .filter((command) => command.name.toLowerCase().startsWith(query))
      .slice(0, 8);

    renderSuggestionButtons(
      commands.map((command) => ({
        description: command.description,
        label: command.usage,
        value: `${command.name} `,
      })),
      (suggestion) => replaceActiveTextToken(input, token, suggestion.value),
    );
  };

  const renderLocalMentionSuggestions = (input, token) => {
    const query = token.value.slice(1).toLowerCase();
    const authors = getMentionCandidates()
      .filter((name) => name.toLowerCase().startsWith(query))
      .slice(0, 8);

    renderSuggestionButtons(
      authors.map((name) => ({
        description: 'Mention this user.',
        label: `@${name}`,
        value: `@${name} `,
      })),
      (suggestion) => replaceActiveTextToken(input, token, suggestion.value),
    );
  };

  const renderSuggestionButtons = (suggestions, onPick) => {
    if (!elements.localChatSuggestions || suggestions.length === 0) {
      clearLocalChatSuggestions();
      return;
    }

    elements.localChatSuggestions.replaceChildren(
      ...suggestions.map((suggestion) => {
        const button = document.createElement('button');
        const label = document.createElement('strong');
        const description = document.createElement('span');

        button.className = 'local-chat-suggestion';
        button.type = 'button';
        label.textContent = suggestion.label;
        description.textContent = suggestion.description;
        button.append(label, description);
        button.addEventListener('click', () => onPick(suggestion));
        return button;
      }),
    );
    elements.localChatSuggestions.hidden = false;
  };

  const clearLocalChatSuggestions = () => {
    if (!elements.localChatSuggestions) {
      return;
    }

    elements.localChatSuggestions.hidden = true;
    elements.localChatSuggestions.replaceChildren();
  };

  const getMentionCandidates = () => {
    const names = new Map();

    if (state.localSession?.user?.nick) {
      names.set(state.localSession.user.nick.toLowerCase(), state.localSession.user.nick);
    }

    for (const message of state.messages.slice(-250)) {
      const name = message.author?.name;

      if (typeof name === 'string' && /^[A-Za-z0-9_]{2,24}$/.test(name)) {
        names.set(name.toLowerCase(), name);
      }
    }

    return [...names.values()].sort((left, right) => left.localeCompare(right));
  };

  const getActiveTextToken = (input) => {
    if (!input) {
      return undefined;
    }

    const cursor = input.selectionStart ?? input.value.length;
    const beforeCursor = input.value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)([\/@][^\s]*)$/);

    if (!match) {
      return undefined;
    }

    return {
      end: cursor,
      start: cursor - match[1].length,
      value: match[1],
    };
  };

  const replaceActiveTextToken = (input, token, replacement) => {
    input.value = `${input.value.slice(0, token.start)}${replacement}${input.value.slice(token.end)}`;
    const cursor = token.start + replacement.length;

    input.focus();
    input.setSelectionRange(cursor, cursor);
    clearLocalChatSuggestions();
  };

  const setLocalSession = ({ session, token, user }) => {
    state.localSession = { token: token ?? session?.token, user };
    state.pendingGoogleOAuth = undefined;
    state.pendingLocalRegistrationEmail = undefined;

    try {
      window.localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, JSON.stringify(state.localSession));
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }

    renderLocalChatControls();
  };

  const clearLocalSession = () => {
    state.localSession = undefined;
    state.pendingGoogleOAuth = undefined;
    state.pendingLocalRegistrationEmail = undefined;

    try {
      window.localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }

    renderLocalChatControls();
  };

  const renderLocalChatControls = () => {
    const isLoggedIn = Boolean(state.localSession?.token);
    const needsNick = Boolean(state.pendingGoogleOAuth || state.pendingLocalRegistrationEmail);

    if (!isLoggedIn) {
      clearLocalChatSuggestions();
    }

    if (elements.localAuthForm) {
      elements.localAuthForm.hidden = isLoggedIn;

      const emailField = elements.localAuthForm.elements.namedItem('email');

      if (emailField) {
        emailField.disabled = needsNick;
        emailField.value = state.pendingGoogleOAuth?.email ??
          state.pendingLocalRegistrationEmail ??
          emailField.value;
      }

      const nickField = elements.localAuthForm.querySelector('[data-local-nick-field]');
      const submitButton = elements.localAuthForm.querySelector('[data-local-auth-action]');

      if (nickField) {
        nickField.hidden = !needsNick;
      }

      if (submitButton) {
        submitButton.textContent = needsNick ? 'Join' : 'Continue';
      }
    }

    if (elements.localGoogleLogin) {
      elements.localGoogleLogin.disabled = isLoggedIn || needsNick;
    }

    if (elements.localMessageForm) {
      elements.localMessageForm.hidden = !isLoggedIn;
    }

    if (elements.localSessionPanel) {
      elements.localSessionPanel.hidden = !isLoggedIn;
    }

    if (elements.localSessionLabel) {
      const user = state.localSession?.user;

      elements.localSessionLabel.textContent = user ? `${user.nick} (${user.role})` : '';
    }
  };

  const setLocalChatStatus = (message) => {
    if (elements.localChatStatus) {
      elements.localChatStatus.textContent = message;
    }
  };

  const isUnknownLocalChatEmailError = (error) =>
    /user was not found/i.test(error?.message ?? '');

  const isChatNearBottom = () =>
    elements.chatList.scrollHeight - elements.chatList.scrollTop - elements.chatList.clientHeight <=
    CHAT_BOTTOM_TOLERANCE_PX;

  const shouldAutoscrollChat = () => state.chatPinnedToBottom && isChatNearBottom();

  const scrollChatToBottom = () => {
    setChatPinnedToBottom(true, 'scroll_to_bottom');
    state.unseenMessageCount = 0;
    elements.chatList.scrollTop = elements.chatList.scrollHeight;

    window.requestAnimationFrame(() => {
      if (!state.chatPinnedToBottom) {
        return;
      }

      elements.chatList.scrollTop = elements.chatList.scrollHeight;
      updateResumeChatControl();
    });
  };

  const updateResumeChatControl = () => {
    if (!elements.resumeChat) {
      return;
    }

    elements.resumeChat.hidden = state.unseenMessageCount === 0 || state.chatPinnedToBottom;
    elements.resumeChat.textContent = formatUnseenMessageCount(state.unseenMessageCount);
  };

  const updateChatFilterControls = () => {
    for (const button of elements.chatFilterButtons ?? []) {
      const platform = button.dataset.chatPlatformFilter;
      const isActive =
        platform === 'all'
          ? areAllChatPlatformsActive()
          : state.activeChatPlatforms.has(platform);

      button.classList.toggle('is-active', isActive);
      button.setAttribute(
        'aria-pressed',
        String(isActive),
      );
    }
  };

  const formatUnseenMessageCount = (count) => {
    if (count > 20) {
      return '20+ new messages';
    }

    return count === 1 ? '1 new message' : `${count} new messages`;
  };

  const formatNumber = (value) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);

  const getViewerDisplay = (viewer) => {
    if (!viewer) {
      return { state: 'unavailable', count: '-', label: 'viewers unavailable' };
    }

    if (viewer.state === 'available') {
      const count = viewer.count ?? 0;

      return {
        state: count === 0 ? 'offline' : 'available',
        count: formatNumber(count),
        label: count === 0 ? 'offline or zero viewers' : 'watching now',
      };
    }

    if (viewer.state === 'disabled') {
      return { state: 'disabled', count: '-', label: 'viewers disabled' };
    }

    return { state: 'unavailable', count: '-', label: 'viewers unavailable' };
  };

  const formatViewerUpdated = (viewers) => {
    const latest = (viewers?.sources ?? [])
      .map((viewer) => new Date(viewer.updatedAt).valueOf())
      .filter((timestamp) => Number.isFinite(timestamp))
      .sort((left, right) => right - left)[0];

    return latest ? `Last viewer update: ${formatDateTime(new Date(latest).toISOString())}` : 'No viewer update yet.';
  };

  const formatViewerSourceUpdated = (viewer) =>
    viewer?.updatedAt ? `Updated ${formatDateTime(viewer.updatedAt)}` : 'No viewer update yet.';

  const createViewerCardTooltip = (platform, row, viewers = {}) => {
    const platformLabel = platform === 'total' ? 'Total viewers' : `${formatPlatform(platform)} viewers`;
    const breakdown = (row.sources ?? [])
      .map((viewer) => {
        const sourceLabel = formatSourceLabel(viewer.source);
        const display = getViewerDisplay(viewer);
        const sourceCount = display.state === 'available' ? formatNumber(viewer.count ?? 0) : display.label;

        return `${sourceLabel}: ${sourceCount}`;
      })
      .filter(Boolean);

    if (platform === 'total') {
      const platformBreakdown = new Map();

      for (const viewer of viewers.sources ?? []) {
        const sourcePlatform = viewer.source?.platform;
        if (!sourcePlatform) {
          continue;
        }

        const current = platformBreakdown.get(sourcePlatform) ?? 0;
        platformBreakdown.set(sourcePlatform, current + (viewer.state === 'available' ? viewer.count ?? 0 : 0));
      }

      const totalBreakdown = [...platformBreakdown.entries()].map(
        ([sourcePlatform, count]) => `${formatPlatform(sourcePlatform)}: ${formatNumber(count)}`,
      );

      return [platformLabel, ...totalBreakdown].join('\n');
    }

    return breakdown.length > 0
      ? [platformLabel, ...breakdown].join('\n')
      : `${platformLabel}: ${row.state === 'available' ? row.count : 'unavailable'}`;
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);

    return Number.isNaN(date.valueOf())
      ? ''
      : formatClock(date);
  };

  const formatDateTime = (timestamp) => {
    const date = new Date(timestamp);

    return Number.isNaN(date.valueOf()) ? 'unknown time' : formatClock(date);
  };

  const formatClock = (date) =>
    new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);

  const getFormFieldValue = (form, name) =>
    form?.elements.namedItem(name)?.value.trim() ?? '';

  const getCurrentViewerReturnTo = () =>
    `${isPopoutPathname(window.location.pathname) ? '/popout' : '/viewer'}${window.location.search}`;

  const clearChatFeed = () => {
    state.messageCount = 0;
    state.messages = [];
    state.messageKeys = new Set();
    state.unseenMessageCount = 0;
    setChatPinnedToBottom(true, 'clear_chat');
    clearLocalChatSuggestions();
    cancelScheduledRender();
    render({ stickToBottom: true, forceChatRender: true });
  };

  elements.resumeChat?.addEventListener('click', () => {
    chatScrollDebug.log('resume_click');
    setChatPinnedToBottom(true, 'resume_click');
    state.unseenMessageCount = 0;
    flushScheduledRender({ stickToBottom: true, forceChatRender: true });
    updateResumeChatControl();
  });

  elements.clearChat?.addEventListener('click', clearChatFeed);

  for (const button of elements.chatFilterButtons ?? []) {
    button.addEventListener('click', () => {
      const platform = button.dataset.chatPlatformFilter ?? 'all';

      if (platform === 'all') {
        state.activeChatPlatforms = new Set(filterPlatforms);
      } else if (state.activeChatPlatforms.has(platform) && state.activeChatPlatforms.size > 1) {
        state.activeChatPlatforms.delete(platform);
      } else if (!state.activeChatPlatforms.has(platform) && filterPlatforms.includes(platform)) {
        state.activeChatPlatforms.add(platform);
      }

      setChatPinnedToBottom(true, 'chat_filter_change', {
        activeChatPlatforms: [...state.activeChatPlatforms],
      });
      state.unseenMessageCount = 0;
      updateChatFilterControls();
      flushScheduledRender({ stickToBottom: true, forceChatRender: true });
    });
  }

  updateChatFilterControls();

  elements.localAuthForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = getFormFieldValue(elements.localAuthForm, 'email');
    const nick = getFormFieldValue(elements.localAuthForm, 'nick');

    try {
      if (state.pendingGoogleOAuth) {
        if (!nick) {
          throw new Error('Nick is required after Google OAuth.');
        }

        const session = await transport.completeGoogleOAuth({
          nick,
          ticket: state.pendingGoogleOAuth.ticket,
        });

        setLocalSession(session);
        setLocalChatStatus('Joined local chat with Google.');
        return;
      }

      if (state.pendingLocalRegistrationEmail) {
        if (!nick) {
          throw new Error('Nick is required to join local chat.');
        }

        const session = await transport.registerLocalUser({
          email: state.pendingLocalRegistrationEmail,
          nick,
        });

        setLocalSession(session);
        setLocalChatStatus('Joined local chat.');
        return;
      }

      const session = await transport.loginLocalUser({ email });

      setLocalSession(session);
      setLocalChatStatus('Logged in.');
    } catch (error) {
      if (isUnknownLocalChatEmailError(error)) {
        state.pendingLocalRegistrationEmail = email;
        renderLocalChatControls();
        setLocalChatStatus('Choose a nick to join local chat.');
      } else {
        setLocalChatStatus(error.message);
      }
    }
  });

  elements.localGoogleLogin?.addEventListener('click', () => {
    if (typeof transport.createGoogleOAuthStartUrl !== 'function') {
      setLocalChatStatus('Google OAuth is not available.');
      return;
    }

    window.location.href = transport.createGoogleOAuthStartUrl({ returnTo: getCurrentViewerReturnTo() });
  });

  elements.localLogout?.addEventListener('click', () => {
    clearLocalSession();
    setLocalChatStatus('Logged out.');
  });

  elements.localMessageForm?.elements.namedItem('text')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearLocalChatSuggestions();
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }

    event.preventDefault();
    elements.localMessageForm.requestSubmit();
  });

  elements.localMessageForm?.elements.namedItem('text')?.addEventListener('input', updateLocalChatSuggestions);

  elements.localMessageForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = getFormFieldValue(elements.localMessageForm, 'text');
    const token = state.localSession?.token;

    if (!token || !text) {
      return;
    }

    try {
      if (text.startsWith('/')) {
        await transport.runLocalModerationCommand({ command: text, token });
        setLocalChatStatus('Moderation command applied.');
      } else {
        await transport.sendLocalMessage({ text, token });
        setLocalChatStatus('Message sent.');
      }

      elements.localMessageForm.elements.namedItem('text').value = '';
      clearLocalChatSuggestions();
    } catch (error) {
      setLocalChatStatus(error.message);
    }
  });

  elements.chatList?.addEventListener('scroll', (event) => {
    setChatPinnedToBottom(isChatNearBottom(), 'scroll', {
      isTrusted: event.isTrusted,
    });

    if (state.chatPinnedToBottom) {
      state.unseenMessageCount = 0;
    }

    updateResumeChatControl();
  });

  elements.chatList?.addEventListener('wheel', (event) => {
    if (event.deltaY >= 0) {
      return;
    }

    setChatPinnedToBottom(false, 'wheel_up', { deltaY: event.deltaY });
    updateResumeChatControl();
  });

  void start();
})();
