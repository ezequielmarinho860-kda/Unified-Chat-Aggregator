(() => {
  const MAX_MESSAGES = 200;
  const reconnectBaseMs = 1_000;
  const reconnectMaxMs = 10_000;
  const state = {
    socket: undefined,
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
  };
  const platformLabels = {
    twitch: 'Twitch',
    kick: 'Kick',
    x: 'X',
    youtube: 'YouTube',
  };
  const platformSymbols = {
    kick: 'K',
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

  const setConnection = (connectionState, label, detail) => {
    elements.connectionCard.dataset.connectionState = connectionState;
    elements.connectionLabel.textContent = label;

    if (elements.connectionDetail) {
      elements.connectionDetail.textContent = detail;
    }
  };

  const start = async () => {
    try {
      await loadSnapshot();
      connectEvents();
    } catch (error) {
      setConnection('error', 'Viewer unavailable', error.message);
      scheduleReconnect();
    }
  };

  const loadSnapshot = async () => {
    setConnection('loading', 'Loading snapshot', 'Fetching public gateway state.');
    const response = await fetch('/api/v1/snapshot', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Snapshot request failed with ${response.status}.`);
    }

    applySnapshot(await response.json());
  };

  const connectEvents = () => {
    state.socket?.close();
    const socket = new WebSocket(createEventsUrl());

    state.socket = socket;
    setConnection('loading', 'Connecting realtime', 'Opening local WebSocket.');
    socket.addEventListener('open', () => {
      state.reconnectAttempt = 0;
      setConnection('connected', 'Live connection', 'Receiving public realtime events.');
    });
    socket.addEventListener('message', (event) => applyEvent(JSON.parse(event.data)));
    socket.addEventListener('close', () => {
      if (state.socket === socket) {
        setConnection('disconnected', 'Disconnected', 'Reconnecting with a fresh snapshot.');
        scheduleReconnect();
      }
    });
    socket.addEventListener('error', () => {
      setConnection('error', 'Connection error', 'Realtime stream is unavailable.');
    });
  };

  const createEventsUrl = () => {
    const url = new URL('/api/v1/events', window.location.href);

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url;
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
      state.chatPinnedToBottom = true;
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

    while (state.messages.length > MAX_MESSAGES) {
      const removedMessage = state.messages.shift();
      state.messageKeys.delete(getMessageKey(removedMessage));
    }

    if (!shouldStickToBottom) {
      state.chatPinnedToBottom = false;
      state.unseenMessageCount += 1;
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
    render();
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

  const render = ({ stickToBottom = state.chatPinnedToBottom } = {}) => {
    const snapshot = state.snapshot ?? {};
    const previousChatScrollTop = elements.chatList.scrollTop;
    const shouldStickToBottom = stickToBottom && shouldAutoscrollChat();

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

    elements.chatList.replaceChildren(...createChatElements());

    if (shouldStickToBottom) {
      scrollChatToBottom();
    } else {
      state.chatPinnedToBottom = false;
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

  const flushScheduledRender = ({ stickToBottom = state.chatPinnedToBottom } = {}) => {
    cancelScheduledRender();

    render({ stickToBottom });
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
        { count: 0, state: 'unavailable' },
      ]),
    );

    for (const viewer of viewers.sources ?? []) {
      const platform = viewer.source?.platform;
      const row = platformRows.get(platform);

      if (!row) {
        continue;
      }

      if (viewer.state === 'available') {
        row.state = 'available';
        row.count += viewer.count ?? 0;
      } else if (row.state !== 'available') {
        row.state = viewer.state ?? 'unavailable';
      }
    }

    for (const [platform, row] of platformRows) {
      updateViewerCard(platform, row.state, row.state === 'available' ? formatNumber(row.count) : '--');
    }

    updateViewerCard('total', 'available', formatNumber(viewers.total ?? 0));
  };

  const updateViewerCard = (platform, viewerState, count) => {
    const card = viewerCards.get(platform);
    const countElement = viewerCountElements.get(platform);

    if (card) {
      card.dataset.viewerState = viewerState;
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

  const createChatElements = () =>
    state.messages.length > 0
      ? state.messages.map(createMessageElement)
      : [createEmptyChatElement()];

  const createMessageElement = (message) => {
    const article = document.createElement('article');
    const avatar = shouldRenderAuthorAvatar(message) ? createAvatarElement(message) : undefined;
    const body = document.createElement('div');
    const meta = document.createElement('div');
    const platform = createPlatformBadge(message.source?.platform);
    const source = createMessageSource(message.source);
    const author = document.createElement('strong');
    const time = document.createElement('time');
    const content = document.createElement('p');

    article.className = 'message';
    article.dataset.platform = message.source?.platform ?? 'unknown';
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
    !['kick', 'twitch'].includes(message.source?.platform);

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
      return [document.createTextNode(message.text ?? '')];
    }

    return fragments.map((fragment) => {
      if (fragment.type === 'emote' && fragment.imageUrl) {
        const image = document.createElement('img');

        image.className = 'chat-emote';
        image.src = fragment.imageUrl;
        image.alt = fragment.text;
        image.title = fragment.text;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        return image;
      }

      return document.createTextNode(fragment.text ?? '');
    });
  };

  const createEmptyChatElement = () => {
    const empty = document.createElement('div');

    empty.className = 'empty-state';
    empty.dataset.chatEmpty = '';
    empty.textContent = 'Waiting for new public chat messages from the realtime gateway.';
    return empty;
  };

  const isChatNearBottom = () =>
    elements.chatList.scrollHeight - elements.chatList.scrollTop - elements.chatList.clientHeight < 48;

  const shouldAutoscrollChat = () => state.chatPinnedToBottom && isChatNearBottom();

  const scrollChatToBottom = () => {
    state.chatPinnedToBottom = true;
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

  elements.resumeChat?.addEventListener('click', () => {
    state.chatPinnedToBottom = true;
    state.unseenMessageCount = 0;
    flushScheduledRender({ stickToBottom: true });
    updateResumeChatControl();
  });

  elements.chatList?.addEventListener('scroll', () => {
    state.chatPinnedToBottom = isChatNearBottom();

    if (state.chatPinnedToBottom) {
      state.unseenMessageCount = 0;
    }

    updateResumeChatControl();
  });

  elements.chatList?.addEventListener('wheel', (event) => {
    if (event.deltaY >= 0) {
      return;
    }

    state.chatPinnedToBottom = false;
    updateResumeChatControl();
  });

  void start();
})();
