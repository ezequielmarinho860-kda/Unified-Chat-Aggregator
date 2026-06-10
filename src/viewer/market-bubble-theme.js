// Market Bubble theme decorations. Presentation only: toggles the
// theater-mode body class and mirrors the already-rendered viewer
// counters into the Market Watch tape. No transport, state, or
// handler access.
(() => {
  const theaterButton = document.querySelector('[data-mb-theater]');

  if (theaterButton) {
    theaterButton.addEventListener('click', () => {
      const active = document.body.classList.toggle('mb-theater');

      theaterButton.setAttribute('aria-pressed', String(active));
      theaterButton.textContent = active ? 'Exit Theater' : 'Theater';
    });
  }

  const tape = document.querySelector('[data-mb-tape]');

  if (!tape) {
    return;
  }

  // Market Watch tape: free CoinGecko spot prices, refreshed once a
  // minute to stay well inside the public rate limit.
  const TAPE_COINS = [
    { id: 'bitcoin', symbol: 'BTC' },
    { id: 'ethereum', symbol: 'ETH' },
    { id: 'solana', symbol: 'SOL' },
    { id: 'hyperliquid', symbol: 'HYPE' },
    { id: 'zcash', symbol: 'ZEC' },
  ];
  const TAPE_REPEATS = 8;
  const PRICE_REFRESH_MS = 60_000;
  const PRICE_ENDPOINT =
    'https://api.coingecko.com/api/v3/coins/markets' +
    `?vs_currency=usd&ids=${TAPE_COINS.map((coin) => coin.id).join(',')}`;

  const quotes = new Map();

  const formatPrice = (price) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: price >= 1000 ? 0 : 2,
    }).format(price);

  const createTapeItem = ({ id, symbol }) => {
    const item = document.createElement('span');
    const symbolElement = document.createElement('span');
    const value = document.createElement('span');
    const quote = quotes.get(id);
    const change = quote?.change;
    let icon;

    if (quote?.image) {
      icon = document.createElement('img');
      icon.src = quote.image;
      icon.alt = '';
      icon.loading = 'lazy';
    } else {
      icon = document.createElement('span');
      icon.style.background = 'var(--dim)';
    }

    item.className = 'mb-tape-item';
    icon.className = 'mb-tape-ico';
    symbolElement.className = 'mb-tape-sym';
    symbolElement.textContent = symbol;
    value.className = 'mb-tape-px';
    value.textContent = quote ? formatPrice(quote.price) : '--';
    item.append(icon, symbolElement, value);

    if (typeof change === 'number') {
      const changeElement = document.createElement('span');

      changeElement.className = `mb-tape-chg ${change >= 0 ? 'mb-tape-chg--up' : 'mb-tape-chg--down'}`;
      changeElement.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
      item.append(changeElement);
    }

    return item;
  };

  const renderTape = () => {
    const items = [];

    for (let repeat = 0; repeat < TAPE_REPEATS; repeat += 1) {
      items.push(...TAPE_COINS.map(createTapeItem));
    }

    tape.replaceChildren(...items);
  };

  const refreshQuotes = async () => {
    try {
      const response = await fetch(PRICE_ENDPOINT);

      if (!response.ok) {
        return;
      }

      const payload = await response.json();

      if (!Array.isArray(payload)) {
        return;
      }

      for (const entry of payload) {
        if (typeof entry?.current_price === 'number') {
          quotes.set(entry.id, {
            price: entry.current_price,
            change:
              typeof entry.price_change_percentage_24h === 'number'
                ? entry.price_change_percentage_24h
                : undefined,
            image: typeof entry.image === 'string' ? entry.image : undefined,
          });
        }
      }

      renderTape();
    } catch {
      // Network hiccup: keep the last rendered quotes.
    }
  };

  renderTape();
  refreshQuotes();
  setInterval(refreshQuotes, PRICE_REFRESH_MS);
})();
