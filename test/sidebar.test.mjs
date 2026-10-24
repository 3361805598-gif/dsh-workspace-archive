import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let record;
const React = {
  createElement: (type, props) => ({ type, props }),
  useMemo: (make) => make(),
  useCallback: (callback) => callback,
};
vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: (value) => { record = value; } } },
  queueMicrotask,
  console,
});
const api = record.factory(() => React).internals;
// Values cross the VM realm, so compare serialized plain data where needed.
const json = (value) => JSON.parse(JSON.stringify(value));
const row = (workspaceId, sessionIds) => ({ workspaceId, sessionIds });
function snapshots(archived = ['a']) {
  return {
    workspaces: {
      phase: 'ready', state: 'live', error: undefined,
      items: [row('hidden', ['a', 'blank', 'child']), row('visible', ['b'])],
      archivedSessionIds: archived, pinnedSessionIds: [],
    },
    sessions: {
      phase: 'ready', ids: ['a', 'blank', 'child', 'b', 'loose'],
      byId: { a: {}, blank: { blank: true }, child: { origin: 'subagent' }, b: {}, loose: {} },
    },
  };
}

test('archived workspace disappears with its blank placeholder and subagent', () => {
  const { workspaces, sessions } = snapshots();
  const filtered = api.sidebarSnapshots(workspaces, sessions);
  assert.deepEqual(json(filtered.workspaces.items.map((item) => item.workspaceId)), ['visible']);
  assert.deepEqual(json(filtered.sessions.ids), ['b', 'loose']);
  assert.deepEqual(Object.keys(filtered.sessions.byId), ['b', 'loose']);
  assert.deepEqual(json(workspaces.items.map((item) => item.workspaceId)), ['hidden', 'visible']);
  assert.equal(sessions.ids.length, 5, 'management and Host snapshots stay intact');
});

test('restoring any real session immediately makes its workspace visible again', () => {
  const { workspaces, sessions } = snapshots([]);
  const filtered = api.sidebarSnapshots(workspaces, sessions);
  assert.equal(filtered.workspaces, workspaces);
  assert.equal(filtered.sessions, sessions);
});

test('a running/skipped unarchived conversation keeps the workspace visible', () => {
  const { workspaces, sessions } = snapshots();
  workspaces.items[0].sessionIds.push('active');
  sessions.byId.active = { running: true };
  assert.deepEqual(json(api.archivedWorkspaceIds(workspaces.items, sessions.byId, ['a'])), []);
});

test('empty and blank-only workspaces stay available for starting work', () => {
  assert.deepEqual(json(api.archivedWorkspaceIds([row('empty', []), row('draft', ['blank'])], { blank: { blank: true } }, [])), []);
});

test('unknown summaries and loading baselines never hide a workspace', () => {
  const { workspaces, sessions } = snapshots();
  delete sessions.byId.a;
  assert.deepEqual(json(api.archivedWorkspaceIds(workspaces.items, sessions.byId, ['a'])), []);
  for (const pending of ['workspaces', 'sessions']) {
    const state = snapshots();
    state[pending].phase = 'pending';
    assert.equal(api.sidebarSnapshots(state.workspaces, state.sessions).workspaces, state.workspaces);
  }
});

test('archived blank sessions remain restorable in the management panel', () => {
  const part = api.partitionWorkspace(['blank'], { blank: { blank: true } }, new Set(['blank']));
  assert.deepEqual(json(part.archived), ['blank']);
});

function sidebarRegistry() {
  const children = { 'sidebar.workspaces.session.menu.item': { kind: 'list', scope: 'root' } };
  const Browser = (props) => props;
  const entry = { component: Browser, options: { priority: 0 }, children, store: {}, inject: () => ({}), locale: 'workspace' };
  const entries = [entry];
  const listeners = new Set();
  let notifications = 0;
  function publish() { notifications += 1; for (const listener of [...listeners]) listener(); }
  const ctx = { slots: {
    entries: () => entries,
    subscribe: (_name, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    register: (options, component) => {
      const extra = { options, component };
      entries.push(extra);
      entries.sort((left, right) => (left.options.priority ?? 0) - (right.options.priority ?? 0));
      publish();
      return () => { const index = entries.indexOf(extra); if (index >= 0) { entries.splice(index, 1); publish(); } };
    },
  } };
  return { ctx, entry, Browser, children, entries, publish, notifications: () => notifications };
}
function browserProps(state, retain = () => {}) {
  return {
    wide: true,
    useWorkspaces: (select) => select(state.workspaces),
    useSessions: (select) => select(state.sessions),
    actions: { retainAccountKeys: retain, setArchivedFilter() {} },
    searchSessions: async () => ({ items: [{ id: 'a' }, { id: 'b' }], hasMore: true }),
    renderSlot() {},
  };
}

test('sidebar adapter retains native child ownership, actions and localization', async () => {
  const registry = sidebarRegistry();
  const stop = api.installSidebarFilter(registry.ctx);
  const retained = [];
  const props = browserProps(snapshots(), (keys) => retained.push(keys));
  const rendered = registry.entry.component(props);
  assert.equal(rendered.type, registry.Browser);
  assert.equal(registry.entry.children, registry.children);
  assert.equal(registry.entry.locale, 'workspace');
  assert.equal(rendered.props.renderSlot, props.renderSlot);
  assert.equal(rendered.props.actions.setArchivedFilter, props.actions.setArchivedFilter);
  assert.deepEqual(json(rendered.props.useWorkspaces((s) => s.items.map((w) => w.workspaceId))), ['visible']);
  assert.deepEqual(json(rendered.props.useSessions((s) => s.ids)), ['b', 'loose']);
  rendered.props.actions.retainAccountKeys(['', '__flat_session_order__', 'visible']);
  assert.ok(retained[0].includes('hidden'), 'hiding must not delete saved expansion/manual order');
  assert.deepEqual(json((await rendered.props.searchSessions('query')).items), [{ id: 'b' }]);
  await Promise.resolve();
  assert.equal(registry.notifications(), 1, 'own publication must not trigger an adapter loop');
  stop();
  assert.equal(registry.entry.component, registry.Browser);
  assert.equal(registry.entries.length, 1);
});

test('archive then restore drives the real adapted browser props', () => {
  const registry = sidebarRegistry();
  const state = snapshots([]);
  const stop = api.installSidebarFilter(registry.ctx);
  const count = () => registry.entry.component(browserProps(state)).props.useWorkspaces((s) => s.items.length);
  assert.equal(count(), 2);
  state.workspaces = { ...state.workspaces, archivedSessionIds: ['a'] };
  assert.equal(count(), 1);
  state.workspaces = { ...state.workspaces, archivedSessionIds: [] };
  assert.equal(count(), 2);
  stop();
});

test('host entry replacement is adapted and unload restores the replacement', async () => {
  const registry = sidebarRegistry();
  const stop = api.installSidebarFilter(registry.ctx);
  const replacement = { ...registry.entry, component: (props) => props };
  const originalReplacement = replacement.component;
  registry.entries.splice(0, 1, replacement);
  registry.publish();
  await Promise.resolve();
  assert.notEqual(replacement.component, originalReplacement);
  assert.equal(registry.entry.component, registry.Browser);
  stop();
  assert.equal(replacement.component, originalReplacement);
});

// Current DSH elects the smallest priority, as confirmed by live Slots inspection.
test('notification contribution never shadows the native sidebar', () => {
  const registry = sidebarRegistry();
  const stop = api.installSidebarFilter(registry.ctx);
  assert.equal(registry.entries[0], registry.entry);
  assert.equal(registry.entries[0].options.priority, 0);
  assert.equal(registry.entries[1].options.priority, Number.MAX_SAFE_INTEGER);
  stop();
});
