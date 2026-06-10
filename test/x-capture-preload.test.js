const assert = require('node:assert/strict');
const test = require('node:test');
const { __testing } = require('../src/x-capture-preload');

const originalDateNow = Date.now;
const originalDocument = global.document;
let currentTime = 1_000_000;

test.afterEach(() => {
  Date.now = originalDateNow;
  global.document = originalDocument;
});

const createElement = ({ ariaLabel = '', textContent = '', testId = '' } = {}) => ({
  getAttribute: (name) => {
    if (name === 'aria-label') {
      return ariaLabel;
    }

    if (name === 'data-testid') {
      return testId;
    }

    return '';
  },
  getBoundingClientRect: () => ({ height: 10, left: 20, top: 30, width: 40 }),
  tagName: 'SPAN',
  textContent,
});

const setDocumentStub = ({ bodyText = '', candidates = [] } = {}) => {
  global.document = {
    body: { innerText: bodyText },
    querySelectorAll: () => candidates,
  };
};

const advanceViewerClock = () => {
  currentTime += 20_000;
  Date.now = () => currentTime;
};

test('records labelled DOM X viewer count debug metadata', () => {
  advanceViewerClock();
  setDocumentStub({
    candidates: [
      createElement({
        ariaLabel: '7,183 viewers',
        testId: 'viewer-count',
      }),
    ],
  });

  assert.equal(__testing.getXViewerCount(), 7183);
  assert.deepEqual(__testing.getLastViewerCountDebug(), {
    count: 7183,
    source: 'dom-candidate',
    target: {
      ariaLabel: '7,183 viewers',
      dataTestId: 'viewer-count',
      rect: {
        height: 10,
        left: 20,
        top: 30,
        width: 40,
      },
      tag: 'span',
      text: '7,183 viewers',
    },
  });
});

test('records body fallback X viewer count debug metadata', () => {
  advanceViewerClock();
  setDocumentStub({
    bodyText: 'Some unrelated X page text 595,731,339 viewers more page text',
  });

  assert.equal(__testing.getXViewerCount(), 595731339);
  assert.deepEqual(__testing.getLastViewerCountDebug(), {
    count: 595731339,
    source: 'dom-body',
    text: 'Some unrelated X page text 595,731,339 viewers more page text',
  });
});
