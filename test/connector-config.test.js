const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_CONNECTORS,
  resolveEnabledConnectors,
} = require('../src/connector-config');

test('uses the default connector set when CONNECTORS is empty', () => {
  assert.deepEqual(resolveEnabledConnectors(undefined), DEFAULT_CONNECTORS);
  assert.deepEqual(resolveEnabledConnectors('  '), DEFAULT_CONNECTORS);
});

test('keeps legacy X auto-enable when a live URL is configured', () => {
  assert.deepEqual(
    resolveEnabledConnectors(undefined, { includeXWhenConfigured: true }),
    [...DEFAULT_CONNECTORS, 'x'],
  );
});

test('parses an explicit connector list', () => {
  assert.deepEqual(resolveEnabledConnectors('x'), ['x']);
  assert.deepEqual(resolveEnabledConnectors('kick,twitch'), ['kick', 'twitch']);
});

test('deduplicates explicit connectors', () => {
  assert.deepEqual(resolveEnabledConnectors('x,x,kick'), ['x', 'kick']);
});

test('rejects unknown connectors', () => {
  assert.throws(() => resolveEnabledConnectors('x,instagram'), /instagram/);
});
