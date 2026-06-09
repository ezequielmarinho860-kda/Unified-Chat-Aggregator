const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserBackendSnapshotState } = require('../src/browser-backend/snapshot-state');

test('applies app events to browser backend snapshot state', () => {
  let currentDate = new Date('2026-06-08T12:00:00.000Z');
  const state = createBrowserBackendSnapshotState({
    initialSnapshot: {
      manifest: { sources: [], title: 'Initial' },
      protocolVersion: '1',
      statuses: [],
      viewers: { sources: [], total: 0 },
    },
    now: () => currentDate,
  });

  currentDate = new Date('2026-06-08T12:01:00.000Z');
  state.applyEvent({
    data: { sources: [{ platform: 'local', sourceId: 'local:chat' }], title: 'Updated' },
    type: 'manifest.update',
  });
  state.applyEvent({
    data: {
      source: { platform: 'local', sourceId: 'local:chat' },
      state: 'connected',
      updatedAt: '2026-06-08T12:01:00.000Z',
    },
    type: 'source.status',
  });
  state.applyEvent({
    data: { sources: [], total: 4 },
    type: 'viewers.update',
  });

  const snapshot = state.getSnapshot();

  assert.equal(snapshot.generatedAt, '2026-06-08T12:01:00.000Z');
  assert.equal(snapshot.manifest.title, 'Updated');
  assert.equal(snapshot.statuses.length, 1);
  assert.deepEqual(snapshot.viewers, { sources: [], total: 4 });
});

test('replaces browser backend snapshot state', () => {
  const state = createBrowserBackendSnapshotState();

  state.applyEvent({
    data: {
      generatedAt: '2026-06-08T12:02:00.000Z',
      manifest: { sources: [], title: 'Replacement' },
      protocolVersion: '1',
      statuses: [],
      viewers: { sources: [], total: 9 },
    },
    type: 'snapshot.replace',
  });

  assert.equal(state.getSnapshot().manifest.title, 'Replacement');
  assert.equal(state.getSnapshot().viewers.total, 9);
});
