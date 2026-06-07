# Unified Chat Aggregator

Unified Chat Aggregator is an Electron desktop app for monitoring live chat from
multiple streaming platforms in one local dashboard. The app currently supports
reading chat from Twitch, Kick, and X, and it can send messages to Twitch and
Kick after the user connects the corresponding account.

The project is still in active development. The current implementation is a
desktop chat aggregator, not a fully automated moderation bot.

## Current Capabilities

### Unified Live Feed

- Displays messages from active connectors in one shared feed.
- Highlights messages written by connected accounts and messages that mention a
  connected account handle.
- Normalizes incoming messages into a common shape with platform, author,
  message text, timestamp, and platform-specific metadata.
- Renders structured message fragments so platform emotes can appear inline
  beside normal text.
- Shows connector status cards for Twitch, Kick, and X.
- Shows platform badges and author badges when the platform payload provides
  badge metadata.
- Renders badge images for Twitch and Kick when an image URL can be resolved,
  with text fallback when an image is unavailable.
- Tracks message counts and last-message timestamps per platform.
- Shows current viewer counts for Twitch and Kick and a combined available total.
- Attempts to capture the X viewer count from the live page DOM.
- Polls Kick viewers on a fixed 10-second cadence and Twitch from a 10-second
  baseline that backs off dynamically using Twitch rate-limit response headers.
- Publishes each platform viewer result as soon as it arrives so a slow Twitch
  lookup does not delay Kick updates.
- Caches Twitch token validation briefly so normal viewer polls require only
  the stream lookup request.
- Uses Kick's official authenticated livestream API, refreshes expired Kick
  tokens when possible, and caches the resolved broadcaster ID between polls.
- Supports feed filtering by platform.
- Supports pausing/resuming autoscroll.
- Supports clearing the visible feed locally.

### Connector Configuration

- Provides an in-app configuration panel for Twitch, Kick, and X.
- Allows each connector to be enabled or disabled.
- Saves configuration to the Electron user data folder as `config.json`.
- Reloads saved configuration when the app starts.
- Treats saved configuration as the main source of truth after a config file
  exists.
- Allows environment variables as a bootstrap path before a saved config exists.
- Preserves Twitch auth data when saving normal connector settings from the UI.

### Twitch

Twitch is the most complete connector at the moment.

Read support:

- Connects to Twitch IRC.
- Joins the configured Twitch channel.
- Parses IRC messages into the normalized chat message model.
- Parses Twitch author badges from IRC tags.
- Loads Twitch global and channel chat badge catalogs through Helix so badge
  images can be rendered in the feed.
- Parses Twitch IRC emote tags so global and subscriber emotes render inline.
- Loads BetterTTV global emotes through the BetterTTV API and channel/shared
  emotes when the Twitch broadcaster ID can be resolved.
- Applies BetterTTV emotes only to text not already recognized as a native
  Twitch emote.
- Resolves likely shared BetterTTV emote codes on first use and caches both
  successful and missing lookups.
- Keeps the BetterTTV catalog cached across automatic IRC reconnects and reloads
  it when the Twitch connector is restarted.
- Handles Twitch `PING` messages with `PONG`.

Account connection:

- Provides a `Connect Twitch` button in the app.
- Opens a Twitch OAuth authorization window.
- Stores the resulting Twitch access token and account identity in the app
  config.
- Hides the connect button once the account is connected and shows a
  disconnect action instead.
- Disconnect clears the saved Twitch token and account identity from the app.
- `Clear login session` clears the Twitch OAuth browser session when the user
  wants the next connect to choose a different Twitch account.
- Does not expose the raw access token to the renderer/public config snapshot.

Write support:

- Sends normal chat messages through the official Twitch Helix chat message API.
- Requires a connected Twitch account with the `user:write:chat` scope.
- Sends messages to the currently configured Twitch channel.

Supported Twitch slash commands:

- `/ban username reason`
- `/timeout username seconds reason`
- `/unban username`
- `/clear`
- `/mod username`
- `/unmod username`
- `/announce message`
- `/announce blue message`
- `/announce green message`
- `/announce orange message`
- `/announce purple message`
- `/announce primary message`

Slash command behavior:

- Slash commands are not sent as plain chat text.
- The app parses supported commands and calls the matching Twitch Helix
  moderation or chat endpoint.
- Unsupported slash commands fail with an explicit error.
- Twitch permissions are still enforced by Twitch. The connected account must
  actually have the required channel role and OAuth scopes.

Required Twitch command scopes:

- Normal chat: `user:write:chat`
- Announcements: `moderator:manage:announcements`
- Ban, timeout, and unban: `moderator:manage:banned_users`
- Clear chat: `moderator:manage:chat_messages`
- Mod and unmod: `channel:manage:moderators`

### Kick

Kick supports live chat reading and authenticated message sending.

Read support:

- Resolves Kick channel slugs from either a plain channel name or a Kick URL.
- Resolves Kick chatroom IDs through Kick HTTP endpoints.
- Falls back to an Electron browser resolver when the HTTP resolver is blocked.
- Connects to Kick's Pusher websocket channel for the resolved chatroom.
- Resolves and saves the Kick chatroom ID automatically when the channel is
  changed and the connector settings are saved.
- Parses Kick Pusher chat events into the normalized chat message model.
- Parses Kick author badge metadata from common Pusher payload locations.
- Parses Kick emotes from Pusher payload metadata and Kick emote markup when an
  emote ID/image can be resolved.
- Renders Kick badge images when the payload provides image URLs or when a known
  global badge can be mapped to the current fallback catalog.
- Deduplicates repeated Kick chat message IDs so reconnect or duplicate Pusher
  events do not spam the unified feed.
- Responds to Pusher ping events with pong messages.
- Automatically attempts reconnects after disconnects or resolver failures.

Configuration support:

- Provides a Kick channel field.
- Provides a `Resolve` button to find the chatroom ID from the channel.
- Provides a `Connect Kick` button for Kick OAuth authorization.
- Keeps a manual chatroom ID field under `Advanced` for fallback/debug use.

Write support:

- Sends normal chat messages through Kick's official chat API.
- Uses Kick OAuth authorization code + PKCE with the `chat:write` scope.
- Uses a server-side OAuth broker when configured so the Kick Client Secret can
  stay outside the desktop app.
- Resolves the configured Kick channel through Kick's public channel API before
  sending.
- Requires `user:read`, `channel:read`, and `chat:write` scopes on the Kick app.
- Uses the build's configured Kick Client ID and OAuth Broker URL by default.
- Stores the Kick access token, refresh token, and account identity locally in
  the app config.
- Disconnect clears the saved Kick tokens and account identity from the app.
- `Clear login session` clears the Kick OAuth browser session when the user
  wants the next connect to choose a different Kick account.
- Refreshes Kick access tokens when a send receives an unauthorized response and
  a refresh token is available.
- Reports Kick permission failures with a clearer message when the channel may
  require the sender to follow, subscribe, or have chat permission.
- Can store Kick Client Secret locally only as a development fallback when no
  OAuth Broker URL is configured.
- Does not expose raw Kick tokens or the Client Secret to the renderer/public
  config snapshot.

Badge note:

- Kick badge image fallback currently uses known global badge image URLs from
  KickDatabase. This is a third-party catalog, not an official Kick API surface,
  so it is useful for the demo but should be treated as a replaceable fallback
  before broad production distribution.

### X

Current X support is browser-capture based.

Read support:

- Accepts an X/Twitter live chat URL, broadcast URL, or handle such as
  `@chooserich`.
- Converts handles into `https://x.com/<handle>/livechat` for capture.
- Opens a dedicated Electron capture window for the configured live URL.
- Can run the capture window hidden or visible, based on the `Show capture
  window` setting.
- Uses a persistent browser partition for the X capture session.
- Provides a `Connect X` button that opens a visible X login window using the
  same persistent browser partition as the capture session.
- Shows whether that browser partition currently has an X login cookie.
- Provides a `Disconnect` action for X that clears the capture browser session
  and restarts only the X connector.
- Sends captured chat messages from the capture preload back to the main app.
- Normalizes captured X messages into the shared chat message model.
- Suppresses the initial captured chat backlog so the feed starts with new
  messages after the capture session begins.

Write support:

- Sends messages by injecting text into the X live chat composer in the capture
  browser session.
- Requires the persistent X capture session to be logged into an account that
  can chat in the live. Use `Connect X` to open the login window for that
  browser session.
- Treats X write as best-effort because it depends on X's browser DOM and chat
  composer behavior rather than an official public chat API.

## App Architecture

### Main Process

`src/main.js` owns the Electron lifecycle, app windows, persisted config,
connector startup, connector restart, and IPC handlers.

Main responsibilities:

- Create and coordinate the connector setup and dashboard windows.
- Load and save app config.
- Start and stop the chat hub.
- Build enabled connectors from the runtime config.
- Run the viewer monitor and broadcast viewer snapshots.
- Broadcast messages, statuses, and config snapshots to renderer windows.
- Handle Twitch OAuth connect/disconnect.
- Handle Kick OAuth connect/disconnect.
- Handle Kick chatroom resolution.
- Handle message sending requests from the renderer.

### Renderer

`src/renderer.js` currently owns the shared setup and dashboard UI behavior.
The windows load separate pages: `src/setup.html` and `src/dashboard.html`.

Renderer responsibilities:

- Populate connector settings from config snapshots.
- Persist and apply the selected light or dark theme.
- Open or focus the dashboard after an explicit connector setup save.
- Save connector settings.
- Trigger connector reconnects.
- Trigger Kick chatroom resolution.
- Trigger Twitch connect/disconnect.
- Trigger Kick connect/disconnect.
- Render connector statuses.
- Render per-platform and total viewer counts.
- Render the unified chat feed.
- Filter messages by platform.
- Send composer messages to the selected platform.

### Preload

`src/preload.js` exposes a narrow `window.chatAggregator` API to the renderer.
The renderer does not receive direct Node.js or Electron access.

### Chat Hub

`src/chat-hub.js` is the connector orchestration layer.

Chat hub responsibilities:

- Validate connector contracts.
- Register active connectors.
- Start and stop connectors.
- Normalize and publish incoming messages.
- Track connector status and message counts.
- Route outgoing messages to the selected active connector.

### Viewer Monitor

`src/viewer-monitor.js` schedules viewer collection and publishes normalized
snapshots. `src/viewer-counts.js` owns the Twitch and Kick HTTP lookups and the
X viewer-label parser.

The monitor uses a 10-second polling baseline, adapts to Twitch rate-limit
headers, and briefly caches Twitch token validation to avoid an extra request
on every normal poll.

### Connectors

Connectors live in `src/connectors`.

Current connectors:

- `twitch-connector.js`: Twitch IRC read connector and Twitch send bridge.
- `twitch-api.js`: Twitch Helix API helpers for sending messages and commands.
- `twitch-auth.js`: Twitch OAuth connection flow.
- `kick-connector.js`: Kick Pusher websocket read connector.
- `kick-api.js`: Kick public API helpers for OAuth validation, user/channel
  lookup, and chat sending.
- `kick-auth.js`: Kick OAuth authorization code + PKCE connection flow.
- `kick-resolver.js`: Kick HTTP channel/chatroom resolver.
- `kick-browser-resolver.js`: Electron browser fallback for Kick resolution.
- `x-connector.js`: X live capture window connector.
- `x-message-parser.js`: X capture payload normalization.

## Configuration

The app stores its saved config in Electron's `userData` directory as
`config.json`. On Windows, that is typically under:

```text
%APPDATA%\Unified Chat Aggregator\config.json
```

The saved config includes:

- enabled/disabled state per connector;
- Twitch channel;
- Twitch OAuth account data;
- Kick channel;
- Kick chatroom ID;
- Kick OAuth account data;
- X live URL, live chat URL, or handle;
- X capture window visibility preference;
- selected light or dark UI theme.

Twitch and Kick access tokens are saved locally in this config file. Kick Client
Secret is saved locally only when using the local development fallback instead
of the OAuth broker. These sensitive values are not sent to the renderer in
public config snapshots, but they still exist on disk when saved.

## Environment Variables

Environment variables are supported mainly for development and first-run
bootstrap.

Supported variables:

| Variable | Purpose |
| --- | --- |
| `CONNECTORS` | Comma-separated connector list, such as `twitch,kick,x`. |
| `TWITCH_CHANNEL` | Overrides the Twitch channel before saved config exists. |
| `TWITCH_ACCESS_TOKEN` | Provides a Twitch token for development flows. |
| `TWITCH_CLIENT_ID` | Overrides the Twitch Client ID. |
| `KICK_CHANNEL` | Overrides the Kick channel before saved config exists. |
| `KICK_CHATROOM_ID` | Provides a Kick chatroom ID manually. |
| `X_LIVE_URL` | Sets the X live URL, live chat URL, or handle and enables X before saved config exists. |
| `X_SHOW_BROWSER` | Shows the X capture window when set to `true`. |
| `VIEWER_GATEWAY_PORT` | Overrides the local read-only viewer gateway port. Defaults to `47831`. |

After a saved config file exists, the app prioritizes saved configuration on
startup so old shell variables do not unexpectedly switch the stream.

## Local Viewer Gateway

The app exposes a read-only public snapshot for future Viewer Mode clients at:

```text
http://127.0.0.1:47831/api/v1/snapshot
```

Realtime events are available over WebSocket at:

```text
ws://127.0.0.1:47831/api/v1/events
```

The first browser-native Viewer Mode shell is served locally at:

```text
http://127.0.0.1:47831/viewer
```

The page consumes only the public gateway contract. It bootstraps from the
snapshot endpoint, reconnects to the realtime WebSocket when needed, and renders
new combined chat messages as a read-only feed with platform, source, author,
badges, emotes, timestamp, and a bounded in-memory list. It also shows combined
and per-source viewer counts, viewer availability states, inferred zero-viewer
offline state, connector state, and the latest viewer update timestamp available
in the public snapshot. When a Twitch connector is enabled, the public manifest
includes a Twitch player config and the Viewer Mode embeds the Twitch player
through a small player adapter boundary. Kick and X publish public watch links
when available, but remain external fallbacks until an embed is technically
approved for those providers.

The public manifest is normalized separately from the internal connector config,
so credentials and local runtime details are not part of the Viewer Mode
contract. Example manifests live in `docs/examples/viewer-manifest-demo.json`
and `docs/examples/viewer-manifest-marketbubble.json`.

Viewer Mode is a fixed-viewport app shell on desktop. New visual blocks should
be added inside existing grid regions or panels with their own internal scroll,
not as loose content below the grid. Letting the page itself grow can push the
player out of view or cause the embedded Twitch player to pause/reload while the
user scrolls.

The gateway binds only to the local loopback address, accepts only `GET` on the
versioned snapshot and Viewer Mode routes, and serializes realtime responses
through a public allowlist. It does not expose chat sending, moderation actions,
tokens, raw platform payloads, local config paths, or environment override
details. Browser WebSocket connections are accepted only from loopback origins.

Twitch embeds require a `parent` parameter matching the page host. The local
Viewer Mode derives that from the current browser hostname. A future hosted
Viewer Mode must serve over HTTPS and use the production MarketBubble domain as
the Twitch embed parent.

## Development Setup

Install dependencies:

```powershell
npm install
```

Start the app:

```powershell
npm start
```

Run lint:

```powershell
npm run lint
```

Run tests:

```powershell
npm test
```

Package the app:

```powershell
npm run package
```

If PowerShell blocks npm scripts on the local machine, either run npm through
`npm.cmd` or update the current-user execution policy:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Validation

The project currently uses:

- ESLint for static validation.
- Node's built-in test runner for unit tests.
- Electron Forge for packaging validation.

Important test areas:

- config normalization and persistence;
- connector configuration parsing;
- chat hub routing and status behavior;
- canonical chat message normalization;
- Twitch IRC parsing and send API behavior;
- Twitch OAuth URL/callback behavior;
- Twitch slash command routing;
- Kick OAuth URL/callback behavior;
- Kick public API send behavior;
- Kick resolver and Pusher parsing;
- Twitch and Kick author badge normalization/rendering;
- Kick duplicate message suppression;
- X capture message normalization;
- viewer count normalization, Twitch validation caching, and adaptive polling.

## Current Known Gaps

- BetterTTV integration currently applies only to Twitch because BetterTTV's
  documented provider list does not include Kick.
- X write support is best-effort browser composer injection, not an official
  API integration.
- X viewer counts are best-effort DOM capture and may become unavailable when X
  changes its live page labels or markup.
- Twitch viewer counts require a connected Twitch account, even though
  anonymous Twitch chat reading can work without one.
- X account connection is handled through the capture browser session, not a
  first-class OAuth flow.
- Twitch slash commands are limited to the supported command list above.
- Kick chat reading still uses the non-official Pusher path. The app now
  suppresses repeated message IDs, but platform payload or protocol changes can
  still require parser updates.
- Kick badge image fallback depends on a third-party catalog for some known
  global badges.
- There is no production installer flow documented yet beyond Electron Forge
  packaging.
- There is no frontend build step because this is currently a plain Electron
  renderer, not a separate frontend package.

## Production Notes

For production, the app should use a registered Twitch application Client ID.
The Client ID is public configuration, not a secret. Any secret-based auth flow
would need a backend service and should not be embedded in the desktop app.

The current Twitch OAuth implementation uses an implicit-style browser flow
inside Electron. The resulting token is stored locally in the app config.
The current Kick OAuth implementation uses authorization code + PKCE inside
Electron. Token exchange can be delegated to a small OAuth broker so production
builds do not need to embed the Kick Client Secret.

Before distributing the app broadly, the project should define:

- production Twitch app ownership;
- token storage expectations;
- release packaging format;
- update strategy;
- user-facing privacy notes;
- clearer error surfaces for platform permission failures.
