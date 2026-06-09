const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createXBrowserConnector } = require('../src/connectors/x-browser-connector');

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'uca-x-browser-connector-'));

class FakePage extends EventEmitter {
  constructor() {
    super();
    this.addedInitScripts = [];
    this.evaluateScripts = [];
    this.exposedFunctions = {};
    this.gotoUrls = [];
    this.viewportSizes = [];
    this.evaluateResult = { ok: true };
  }

  async addInitScript({ content }) {
    this.addedInitScripts.push(content);
  }

  async exposeFunction(name, handler) {
    this.exposedFunctions[name] = handler;
  }

  async goto(url, options) {
    this.gotoUrls.push({ options, url });
  }

  async evaluate(script) {
    this.evaluateScripts.push(script);
    return this.evaluateResult;
  }

  async setViewportSize(size) {
    this.viewportSizes.push(size);
  }
}

class FakeContext extends EventEmitter {
  constructor(pages = [new FakePage()]) {
    super();
    this.pagesList = pages;
    this.closed = false;
  }

  pages() {
    return this.pagesList;
  }

  async newPage() {
    const page = new FakePage();

    this.pagesList.push(page);
    return page;
  }

  async close() {
    this.closed = true;

    for (const page of this.pagesList) {
      page.emit('close');
    }
  }
}

test('launches a persistent browser profile and bridges X chat events', async () => {
  const tempDir = createTempDir();
  const browserExecutablePath = path.join(tempDir, 'chrome.exe');
  const page = new FakePage();
  const context = new FakeContext([page]);
  const launchCalls = [];
  const connector = createXBrowserConnector({
    browserExecutablePath,
    launchPersistentContext: async (userDataDir, options) => {
      launchCalls.push({ options, userDataDir });
      return context;
    },
    liveUrl: '@chooserich',
    resolveBrowserExecutablePath: () => browserExecutablePath,
    userDataDir: path.join(tempDir, 'profile'),
  });
  const messages = [];
  const statuses = [];
  const errors = [];

  connector.onMessage((message) => messages.push(message));
  connector.onStatus((status) => statuses.push(status));
  connector.onError((error) => errors.push(error));

  await connector.connect();
  page.exposedFunctions.xCaptureStatus({
    capture: 'observing',
    state: 'observing',
    viewerCount: 1234,
  });
  page.exposedFunctions.xCaptureMessage({
    authorName: 'Ana',
    text: 'hello x',
    timestamp: '2026-06-09T12:00:00.000Z',
    username: '@ana',
  });

  const sent = await connector.send(' hello x ');

  assert.equal(launchCalls[0].userDataDir, path.join(tempDir, 'profile'));
  assert.equal(launchCalls[0].options.executablePath, browserExecutablePath);
  assert.equal(launchCalls[0].options.headless, false);
  assert.deepEqual(launchCalls[0].options.viewport, { height: 760, width: 900 });
  assert.equal(page.gotoUrls[0].url, 'https://x.com/chooserich/livechat');
  assert.match(page.addedInitScripts[0], /xCaptureMessage/);
  assert.equal(statuses.at(-1).viewerCount, 1234);
  assert.equal(messages[0].platform, 'x');
  assert.equal(messages[0].text, 'hello x');
  assert.equal(sent.ok, true);
  assert.match(page.evaluateScripts[0], /hello x/);
  assert.equal(errors.length, 0);

  await connector.disconnect();
  assert.equal(context.closed, true);
});

test('rejects X browser capture when no browser executable is available', async () => {
  const connector = createXBrowserConnector({
    liveUrl: 'https://x.com/i/broadcasts/1',
    resolveBrowserExecutablePath: () => undefined,
    launchPersistentContext: async () => new FakeContext(),
  });

  await assert.rejects(() => connector.connect(), /Chrome or Edge/);
});
