/**
 * Unit tests for the pure helpers inside the workspace-archive Client bundle.
 *
 * These tests deliberately do not re-implement anything: they materialize the
 * real `client.js` through the same `window.__ModuleLoader__` facade the Web
 * shell installs, run its factory with a minimal React stub, and assert the
 * `internals` seam the factory exposes for exactly this purpose. If the bundle
 * and these tests ever disagree, the bundle wins the argument — fix the test,
 * not the shipped artifact.
 *
 * Run from the package root: `npm test`, which points the test runner at the
 * `test/` tree through a glob. A bare directory argument is not expanded by the
 * test runner on Node 26, so `node --test test/` does not work there.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

/* ---------------------------------------------------------------------- *
 * Materialize the shipped artifact
 * ---------------------------------------------------------------------- */

/** The module record client.js registers during import. */
let captured = null;

globalThis.window = {
  __ModuleLoader__: {
    /**
     * Capture the registration; the shell would normally enqueue it.
     * @param record - the module record `{ id, factory }`.
     */
    load(record) {
      captured = record;
    },
  },
};

await import(new URL('../client.js', import.meta.url));

assert.ok(captured !== null, 'client.js did not register through window.__ModuleLoader__.load()');
assert.equal(captured.id, '@local/dsh-workspace-archive', 'client.js must register under the package id');
assert.equal(typeof captured.factory, 'function', 'the module record must carry a factory');

/** Minimal React surface: the factory only destructures hooks at load time. */
const reactStub = {
  /* Elements keep a walkable shape so a test can drive a rendered control. */
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
  }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useMemo: (factory) => factory(),
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useCallback: (callback) => callback,
};

/** Materialized module exports; any non-React request is a hard failure. */
const moduleExports = captured.factory((id) => {
  if (id === 'react') return reactStub;
  throw new Error('unexpected require: ' + id);
});

const internals = moduleExports.internals;
assert.ok(internals !== null && typeof internals === 'object', 'the factory must export an `internals` object');

const {
  NS,
  PANEL_ID,
  MENU_ID,
  PIN_MENU_ID,
  OVERLAY_ID,
  PANEL_ORDER,
  OVERLAY_ORDER,
  MENU_ORDER,
  PIN_MENU_ORDER,
  PIN_STORAGE_KEY,
  PIN_STORAGE_VERSION,
  PIN_LIMIT,
  partitionWorkspace,
  ungroupedSessionIds,
  isActiveRefusal,
  summarizeRun,
  formatRelative,
  sameIds,
  prunePins,
  desiredLead,
  leadSatisfied,
  planPinMoves,
  readPins,
  writePins,
} = internals;

/* ---------------------------------------------------------------------- *
 * Module shape and frozen constants
 * ---------------------------------------------------------------------- */

test('client module: registers the package id, injects its services, exposes apply', () => {
  assert.equal(captured.id, '@local/dsh-workspace-archive');
  assert.equal(typeof moduleExports.apply, 'function', 'the module must export apply()');
  assert.deepEqual(moduleExports.inject, ['slots', 'locale', 'uiWorkspace', 'workspaces', 'sessions']);
});

test('internals: identity constants hold the frozen values', () => {
  assert.equal(NS, 'dsh-workspace-archive');
  assert.equal(PANEL_ID, 'workspace-archive');
  assert.equal(MENU_ID, 'workspace-archive.archive-workspace');
  assert.equal(PIN_MENU_ID, 'workspace-archive.pin-workspace');
  assert.equal(OVERLAY_ID, 'workspace-archive.dialog');
  assert.equal(PIN_STORAGE_KEY, 'dsh.workspace-archive.pinned-workspaces');
  assert.equal(PIN_STORAGE_VERSION, 1);
});

test('internals: the two menu rows never collide and both stay package-namespaced', () => {
  assert.notEqual(MENU_ID, PIN_MENU_ID, 'the archive row and the pin row need distinct slot ids');
  for (const id of [MENU_ID, PIN_MENU_ID]) {
    assert.match(id, /^workspace-archive\./, `${id} must carry the package namespace`);
  }
});

test('internals: order constants are finite numbers', () => {
  const orders = { MENU_ORDER, PANEL_ORDER, OVERLAY_ORDER, PIN_MENU_ORDER };
  for (const [name, value] of Object.entries(orders)) {
    assert.equal(typeof value, 'number', `${name} must be a number, found ${typeof value}`);
    assert.ok(Number.isFinite(value), `${name} must be finite, found ${String(value)}`);
  }
});

test('internals: every frozen helper is exported as a function', () => {
  const helpers = {
    partitionWorkspace,
    ungroupedSessionIds,
    isActiveRefusal,
    summarizeRun,
    formatRelative,
    sameIds,
    prunePins,
    desiredLead,
    leadSatisfied,
    planPinMoves,
    readPins,
    writePins,
  };
  for (const [name, value] of Object.entries(helpers)) {
    assert.equal(typeof value, 'function', `${name} must be a function, found ${typeof value}`);
  }
});

/* ---------------------------------------------------------------------- *
 * Service resolution — the regression that made every button look dead
 *
 * Cordis gates `ctx.<service>` on the fiber's `inject` declaration and THROWS
 * `cannot get property "<name>" without inject` for an undeclared read. Inside
 * a React event handler that throw is swallowed by the error boundary, so the
 * control simply does nothing. These tests drive the real `apply()` through a
 * proxy that enforces the gate exactly as the Client root does.
 * ---------------------------------------------------------------------- */

/** Core Context surface: framework verbs, never a declared service. */
const CONTEXT_VERBS = new Set([
  'effect',
  'get',
  'inject',
  'interval',
  'isolate',
  'on',
  'once',
  'provide',
  'set',
  'timeout',
]);

/**
 * Build a fake Client root that enforces Cordis's inject gate.
 * @param services - the service instances this root provides.
 * @returns the gated context and every slot registration it received.
 */
function enforcingContext(services) {
  const registrations = [];
  const declared = new Set(moduleExports.inject);
  const base = {
    ...services,
    slots: {
      inject: (_name, body) => body(),
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
    effect: (body) => {
      const dispose = body();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    on: () => () => {},
  };
  const ctx = new Proxy(base, {
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      if (CONTEXT_VERBS.has(property)) return target[property];
      if (!declared.has(property)) throw new Error(`cannot get property "${property}" without inject`);
      return target[property];
    },
  });
  return { ctx, registrations };
}

/**
 * One realistic live snapshot pair plus the services that carry them. The
 * Workspace list is mutable on purpose: a test publishes the same kind of order
 * change the Host stream produces, and `insertBefore` records and applies a
 * move exactly the way the Host registry does (remove, then insert before the
 * anchor, or append without one).
 * @param options - ids, archive set, workspace rows, phase, and pin support.
 * @returns the fake service instances plus the seams a test drives.
 */
function liveServices(options) {
  const summaries = {};
  for (const id of options.ids) {
    summaries[id] = { id, displayTitle: id, blank: false, running: false, updatedAt: 1_000 };
  }
  const items =
    options.workspaces ?? [{ workspaceId: 'w1', title: 'Proj', path: '/tmp/proj', sessionIds: options.ids }];
  let phase = options.phase ?? 'ready';
  let refuseInsert = false;
  const listeners = new Set();
  /** Every `insertBefore(workspaceId, beforeWorkspaceId)` the plugin issued. */
  const insertCalls = [];

  /** Publish a new Workspace order the way one stream frame would. */
  function publish(nextItems) {
    items.length = 0;
    items.push(...nextItems);
    for (const listener of [...listeners]) listener();
  }

  const services = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    uiWorkspace: {
      archiveSession: async () => {},
      unarchiveSession: async () => {},
      openSession: () => {},
    },
    workspaces: {
      list: {
        getSnapshot: () => ({ phase, archivedSessionIds: options.archived ?? [], items }),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      /* A build without the reorder verb is a supported runtime, not a failure. */
      insertBefore:
        options.pinSupported === false
          ? undefined
          : async (workspaceId, beforeWorkspaceId) => {
              insertCalls.push([workspaceId, beforeWorkspaceId]);
              if (refuseInsert) throw new Error('reorder refused');
              const moved = items.find((item) => item.workspaceId === workspaceId);
              const without = items.filter((item) => item.workspaceId !== workspaceId);
              const at =
                beforeWorkspaceId === undefined
                  ? without.length
                  : without.findIndex((item) => item.workspaceId === beforeWorkspaceId);
              if (at === -1) throw new Error('unknown anchor ' + String(beforeWorkspaceId));
              without.splice(at, 0, moved);
              publish(without);
            },
    },
    sessions: {
      list: { getSnapshot: () => ({ ids: options.ids, byId: summaries }), subscribe: () => () => {} },
    },
    /* Test-only seams, never part of a service the plugin may read. */
    publish,
    insertCalls,
    workspaceIds: () => items.map((item) => item.workspaceId),
    refuseInsert(next) {
      refuseInsert = next;
    },
    setPhase(next) {
      phase = next;
    },
  };
  return services;
}

/**
 * Install an in-memory localStorage for one test, then take it away again.
 * The shipped store persists to localStorage under a name key; a plugin that
 * pins Workspaces has to survive the same environment, including its absence.
 * @param initial - seed entries, keyed exactly as the plugin stores them.
 * @returns the recorded entries plus the restore hook.
 */
function stubStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
  return {
    entries,
    restore() {
      delete globalThis.localStorage;
    },
  };
}

/** Let the pin controller's microtask passes and the RPC promises settle. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('apply: an enforcing root lets a workspace batch reach the confirmation layer', () => {
  const { ctx, registrations } = enforcingContext(liveServices({ ids: ['a', 'b'] }));
  moduleExports.apply(ctx);
  const main = registrations.find((entry) => entry.options.name === 'main');
  assert.ok(main !== undefined, 'apply() must register the main panel');
  const face = main.options.inject();

  face.requestArchive({ key: 'w1', title: 'Proj', path: '/tmp/proj', sessionIds: ['a', 'b'] });

  const pending = face.hooks.waState.getSnapshot().pending;
  assert.ok(pending !== null, 'requestArchive must open the confirmation layer, not silently no-op');
  assert.deepEqual(pending.targets, ['a', 'b']);
});

test('apply: confirming a batch archives every pending session through uiWorkspace', async () => {
  const services = liveServices({ ids: ['a', 'b'] });
  const archived = [];
  services.uiWorkspace.archiveSession = async (id, options) => {
    archived.push([id, options === undefined ? null : options]);
  };
  const { ctx, registrations } = enforcingContext(services);
  moduleExports.apply(ctx);
  const face = registrations.find((entry) => entry.options.name === 'main').options.inject();

  face.requestArchive({ key: 'w1', title: 'Proj', path: '/tmp/proj', sessionIds: ['a', 'b'] });
  face.confirmPending(false);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(archived, [['a', null], ['b', null]], 'each pending session must be archived, in order');
  const state = face.hooks.waState.getSnapshot();
  assert.equal(state.run, null, 'the run must have settled');
  assert.ok(state.result !== null, 'a settled run must publish a result');
  assert.deepEqual(state.result.archivedIds, ['a', 'b']);
});

test('apply: the row entry archives its whole workspace', () => {
  const { ctx, registrations } = enforcingContext(liveServices({ ids: ['a'] }));
  moduleExports.apply(ctx);
  const menu = registrations.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item');
  assert.ok(menu !== undefined, 'apply() must register the session-row menu entry');
  const face = menu.options.inject();

  face.requestArchiveForSession('a');

  assert.ok(
    face.hooks.waState.getSnapshot().pending !== null,
    'the row entry must resolve the owning workspace and open the confirmation',
  );
});

test('apply: a batch with nothing left to archive reports a notice, never silence', () => {
  const { ctx, registrations } = enforcingContext(liveServices({ ids: ['a'], archived: ['a'] }));
  moduleExports.apply(ctx);
  const face = registrations.find((entry) => entry.options.name === 'main').options.inject();

  face.requestArchive({ key: 'w1', title: 'Proj', path: '/tmp/proj', sessionIds: ['a'] });

  const state = face.hooks.waState.getSnapshot();
  assert.equal(state.pending, null, 'nothing to archive must not open a confirmation');
  assert.ok(state.notice !== null, 'a no-op must explain itself instead of looking like a dead button');
});

test('apply: an unexpected failure surfaces a notice instead of a dead button', () => {  const services = liveServices({ ids: ['a'] });
  services.sessions.list.getSnapshot = () => {
    throw new Error('carrier exploded');
  };
  const { ctx, registrations } = enforcingContext(services);
  moduleExports.apply(ctx);
  const face = registrations.find((entry) => entry.options.name === 'main').options.inject();

  assert.doesNotThrow(() => face.requestArchive({ key: 'w1', title: 'Proj', path: '/tmp/proj', sessionIds: ['a'] }));

  const notice = face.hooks.waState.getSnapshot().notice;
  assert.ok(notice !== null, 'a thrown action must become a visible notice');
  assert.match(notice.message, /carrier exploded/);
});

/* ---------------------------------------------------------------------- *
 * Component-level click path — the operator's actual gesture
 *
 * The action tests above prove the runner works when called directly. This one
 * proves the wiring in front of it: render the real page and the real overlay
 * with the runner's inject face, click the rendered control, and follow the
 * effect through to `uiWorkspace`. "Clicking the button does nothing" is exactly
 * the failure this asserts against.
 * ---------------------------------------------------------------------- */

/**
 * Expand a stubbed element tree into a flat list, rendering function
 * components with the stubbed hook surface.
 * @param node - element, array, or primitive.
 * @param out - accumulator.
 * @returns every host element in render order.
 */
function flattenTree(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (Array.isArray(node)) {
    for (const child of node) flattenTree(child, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (typeof node.type === 'function') {
    flattenTree(node.type(node.props), out);
    return out;
  }
  out.push(node);
  flattenTree(node.props.children, out);
  return out;
}

test('page: clicking "archive all" opens the confirmation, then archives every session', async () => {
  const services = liveServices({ ids: ['a', 'b'] });
  const archived = [];
  services.uiWorkspace.archiveSession = async (id) => {
    archived.push(id);
  };
  const translations = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`);
  const { ctx, registrations } = enforcingContext(services);
  moduleExports.apply(ctx);

  const registrationOf = (name) => registrations.find((entry) => entry.options.name === name);
  const page = registrationOf('main');
  const overlay = registrationOf('shell.overlay');
  assert.ok(page !== undefined && overlay !== undefined, 'apply() must register the panel and the overlay');

  /* Render both the way the slot renderer would: inject face + standard hooks. */
  const pageInjected = page.options.inject();
  const store = pageInjected.hooks.waState;
  const seat = (face) => ({
    ...face,
    t: translations,
    useWorkspaces: (selector) => selector(services.workspaces.list.getSnapshot()),
    useSessions: (selector) => selector(services.sessions.list.getSnapshot()),
    useWaState: (selector) => selector(face.hooks.waState.getSnapshot()),
    useWaPins: (selector) => selector(face.hooks.waPins.getSnapshot()),
  });

  const buttons = flattenTree(page.component(seat(pageInjected))).filter((element) => element.type === 'button');
  const archiveAll = buttons.find((element) => element.props.children === 'group.archiveAll');
  assert.ok(archiveAll !== undefined, 'the panel must render an 归档全部 control');
  assert.notEqual(archiveAll.props.disabled, true, 'a workspace with 2 pending sessions must offer the control enabled');

  archiveAll.props.onClick();
  assert.deepEqual(store.getSnapshot().pending.targets, ['a', 'b'], 'the click must open the confirmation layer');

  const confirm = flattenTree(overlay.component(seat(overlay.options.inject()))).find(
    (element) => element.type === 'button' && String(element.props.children).startsWith('dialog.confirmArchive'),
  );
  assert.ok(confirm !== undefined, 'the overlay must render the confirmation control once a request is pending');

  confirm.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(archived, ['a', 'b'], 'confirming must archive every pending session through uiWorkspace');
  assert.deepEqual(store.getSnapshot().result.archivedIds, ['a', 'b'], 'the settle must publish a result');
});

/* ---------------------------------------------------------------------- *
 * Workspace pins
 *
 * A pinned Workspace has to LEAD the sidebar list, and the Host has no
 * Workspace pin verb — so the plugin keeps the set and enforces it through the
 * very reorder the shipped sidebar drag calls. These tests cover the planner,
 * the durable write, and the cases a happy path never reaches: a new Workspace
 * arriving at the head, a deleted one, a refused reorder, a storage-less
 * browser, and a build without the reorder verb.
 * ---------------------------------------------------------------------- */

/**
 * Apply one DOM-insertBefore-like move the way the Host registry does.
 * @param order - current ids.
 * @param id - id to move.
 * @param anchor - id to insert before, or undefined to append.
 * @returns the resulting order.
 */
function applyInsertBefore(order, id, anchor) {
  const without = order.filter((candidate) => candidate !== id);
  const at = anchor === undefined ? without.length : without.indexOf(anchor);
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/**
 * One Workspace row for a fake list.
 * @param workspaceId - Workspace id.
 * @param sessionIds - the Sessions it accounts for.
 * @returns the row.
 */
function workspaceRow(workspaceId, sessionIds) {
  return { workspaceId, title: workspaceId, path: '/tmp/' + workspaceId, sessionIds };
}

/**
 * Apply the artifact against one fake root and hand back the plumbing every
 * pin test needs, so each test states only its own scenario.
 * @param services - the fake services from liveServices().
 * @returns the panel face, the slot registrations, and a seat factory.
 */
function mount(services) {
  const { ctx, registrations } = enforcingContext(services);
  moduleExports.apply(ctx);
  const registrationOf = (name) => registrations.find((entry) => entry.options.name === name);
  /* The session-row menu now carries two of our rows, so a pin test addresses
     its own registration by id instead of by slot name. */
  const registrationById = (id) => registrations.find((entry) => entry.options.id === id);
  const face = registrationOf('main').options.inject();
  const translations = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`);
  const seat = (target) => ({
    ...target,
    t: translations,
    useWorkspaces: (selector) => selector(services.workspaces.list.getSnapshot()),
    useSessions: (selector) => selector(services.sessions.list.getSnapshot()),
    useWaState: (selector) => selector(target.hooks.waState.getSnapshot()),
    useWaPins: (selector) => selector(target.hooks.waPins.getSnapshot()),
  });
  return { face, registrations, registrationOf, registrationById, seat };
}

test('sameIds: compares element by element, order included', () => {
  assert.equal(sameIds([], []), true);
  assert.equal(sameIds(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameIds(['a', 'b'], ['b', 'a']), false);
  assert.equal(sameIds(['a'], ['a', 'b']), false);
});

test('prunePins: keeps live pins in pin order, deduped and capped', () => {
  assert.deepEqual(prunePins(['w2', 'w1', 'ghost', 'w2'], ['w1', 'w2']), ['w2', 'w1']);
  const many = Array.from({ length: PIN_LIMIT + 5 }, (unused, index) => `w${index}`);
  assert.equal(prunePins(many, many).length, PIN_LIMIT);
});

test('desiredLead: only pins that still name a live workspace lead, in pin order', () => {
  assert.deepEqual(desiredLead(['w1', 'w2', 'w3'], ['w3', 'w1']), ['w3', 'w1']);
  assert.deepEqual(desiredLead(['w1'], ['ghost']), []);
});

test('leadSatisfied: an order already led by the pin block needs nothing', () => {
  assert.equal(leadSatisfied(['w2', 'w1', 'w3'], ['w2']), true);
  assert.equal(leadSatisfied(['w1', 'w2', 'w3'], ['w2']), false);
  assert.equal(leadSatisfied([], []), true);
});

test('planPinMoves: a workspace created at the head costs exactly one move', () => {
  const order = ['wNew', 'w2', 'w1'];
  assert.deepEqual(planPinMoves(order, desiredLead(order, ['w2'])), [['w2', 'wNew']]);
});

test('planPinMoves: an already-correct order yields no move at all', () => {
  const order = ['w2', 'w1'];
  assert.deepEqual(planPinMoves(order, desiredLead(order, ['w2'])), []);
});

test('planPinMoves: a scrambled order converges without reshuffling the unpinned rows', () => {
  const order = ['w3', 'x', 'w1', 'y', 'w2'];
  let simulated = order.slice();
  for (const [id, anchor] of planPinMoves(order, desiredLead(order, ['w1', 'w2']))) {
    simulated = applyInsertBefore(simulated, id, anchor);
  }
  assert.deepEqual(simulated, ['w1', 'w2', 'w3', 'x', 'y']);
});

test('planPinMoves: with every workspace pinned the last move appends', () => {
  const order = ['w2', 'w1'];
  assert.deepEqual(planPinMoves(order, desiredLead(order, ['w1', 'w2'])), [['w2', undefined]]);
});

test('planPinMoves: unpinning keeps the block contiguous and lands the row right below it', () => {
  const order = ['w1', 'w2', 'w3']; // pins were [w1, w2] before w1 was dropped
  let simulated = order.slice();
  for (const [id, anchor] of planPinMoves(order, desiredLead(order, ['w2', 'w1']))) {
    simulated = applyInsertBefore(simulated, id, anchor);
  }
  assert.deepEqual(simulated, ['w2', 'w1', 'w3']);
  assert.deepEqual(planPinMoves(simulated, desiredLead(simulated, ['w2'])), []);
});

test('readPins: round-trips exactly what writePins stored', () => {
  assert.deepEqual(readPins(writePins(['w2', 'w1'])), ['w2', 'w1']);
});

test('readPins: an unknown version, junk, or a non-string entry yields an empty list', () => {
  assert.deepEqual(readPins(null), []);
  assert.deepEqual(readPins(''), []);
  assert.deepEqual(readPins('not json'), []);
  assert.deepEqual(readPins('[]'), []);
  assert.deepEqual(readPins(JSON.stringify({ version: 99, workspaceIds: ['w1'] })), []);
  assert.deepEqual(readPins(JSON.stringify({ version: PIN_STORAGE_VERSION, workspaceIds: ['w1', 7, '', 'w1'] })), ['w1']);
});

test('apply: pinning reorders the row in front of the current head and persists the set', async () => {
  const storage = stubStorage();
  try {
    const services = liveServices({
      ids: ['a', 'b'],
      workspaces: [workspaceRow('w1', ['a']), workspaceRow('w2', ['b'])],
    });
    const { face } = mount(services);
    assert.equal(face.pinSupported, true, 'this build exposes the reorder verb');

    face.togglePinWorkspace('w2');
    await settle();

    assert.deepEqual(services.insertCalls, [['w2', 'w1']], 'the new pin must lead the list');
    assert.deepEqual(services.workspaceIds(), ['w2', 'w1']);
    assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w2']);
    assert.equal(storage.entries.get(PIN_STORAGE_KEY), writePins(['w2']), 'the pin set must be persisted');
  } finally {
    storage.restore();
  }
});

test('apply: the newest pin leads the block and an already-placed row costs no call', async () => {
  const storage = stubStorage();
  try {
    const services = liveServices({
      ids: ['a', 'b', 'c'],
      workspaces: [workspaceRow('w1', ['a']), workspaceRow('w2', ['b']), workspaceRow('w3', ['c'])],
    });
    const { face } = mount(services);

    face.togglePinWorkspace('w1');
    await settle();
    assert.deepEqual(services.insertCalls, [], 'w1 already leads, so the pin must not call the Host');

    face.togglePinWorkspace('w2');
    await settle();
    assert.deepEqual(services.workspaceIds(), ['w2', 'w1', 'w3'], 'the second pin becomes the new head');
    assert.equal(services.insertCalls.length, 1, 'reaching that order must cost exactly one move');
    assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w2', 'w1']);
  } finally {
    storage.restore();
  }
});

test('apply: a workspace created at the head is pushed back behind the pinned block', async () => {
  const storage = stubStorage();
  try {
    const rows = {
      w1: workspaceRow('w1', ['a']),
      w2: workspaceRow('w2', ['b']),
      w3: workspaceRow('w3', ['c']),
      w4: workspaceRow('w4', ['d']),
    };
    const services = liveServices({ ids: ['a', 'b', 'c', 'd'], workspaces: [rows.w1, rows.w2, rows.w3] });
    const { face } = mount(services);

    face.togglePinWorkspace('w1');
    face.togglePinWorkspace('w2');
    await settle();
    assert.deepEqual(services.workspaceIds(), ['w2', 'w1', 'w3']);

    /* The Host prepends every newly created Workspace; the invariant must not
       depend on the panel being open, so the subscription repairs it. */
    services.publish([rows.w4, ...services.workspaceIds().map((id) => rows[id])]);
    await settle();

    assert.deepEqual(services.workspaceIds(), ['w2', 'w1', 'w4', 'w3'], 'the pinned block must lead again');
    assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w2', 'w1'], 'the pin set itself is unchanged');
  } finally {
    storage.restore();
  }
});

test('apply: unpinning drops the row just below the remaining pinned block', async () => {
  const storage = stubStorage();
  try {
    const services = liveServices({
      ids: ['a', 'b', 'c'],
      workspaces: [workspaceRow('w1', ['a']), workspaceRow('w2', ['b']), workspaceRow('w3', ['c'])],
    });
    const { face } = mount(services);

    face.togglePinWorkspace('w1');
    face.togglePinWorkspace('w2');
    await settle();
    assert.deepEqual(services.workspaceIds(), ['w2', 'w1', 'w3']);

    face.togglePinWorkspace('w2');
    await settle();

    assert.deepEqual(services.workspaceIds(), ['w1', 'w2', 'w3'], 'the unpinned row lands below the block');
    assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w1']);
    assert.equal(storage.entries.get(PIN_STORAGE_KEY), writePins(['w1']));
  } finally {
    storage.restore();
  }
});

test('apply: deleting a pinned workspace prunes the set and the stored payload', async () => {
  const storage = stubStorage();
  try {
    const rows = { w1: workspaceRow('w1', ['a']), w2: workspaceRow('w2', ['b']) };
    const services = liveServices({ ids: ['a', 'b'], workspaces: [rows.w1, rows.w2] });
    const { face } = mount(services);

    face.togglePinWorkspace('w2');
    await settle();
    assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w2']);

    services.publish([rows.w1]);
    await settle();

    assert.deepEqual(face.hooks.waPins.getSnapshot(), [], 'a deleted workspace must not stay pinned');
    assert.equal(storage.entries.get(PIN_STORAGE_KEY), writePins([]), 'storage has to follow the prune');
  } finally {
    storage.restore();
  }
});

test('apply: a loading list never prunes the persisted pin set', async () => {
  const storage = stubStorage({ [PIN_STORAGE_KEY]: writePins(['w2']) });
  try {
    const rows = { w1: workspaceRow('w1', ['a']), w2: workspaceRow('w2', ['b']) };
    const services = liveServices({ ids: ['a', 'b'], workspaces: [rows.w1, rows.w2] });
    services.setPhase('pending');
    const { face } = mount(services);

    await settle();
    assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w2'], 'an empty pending list is not evidence of deletion');

    services.setPhase('ready');
    services.publish([rows.w2, rows.w1]);
    await settle();
    assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w2'], 'the pin survives into the ready phase');
    assert.equal(storage.entries.get(PIN_STORAGE_KEY), writePins(['w2']));
  } finally {
    storage.restore();
  }
});

test('apply: a refused reorder is reported, does not commit the pin, and is not retried', async () => {
  const storage = stubStorage();
  try {
    const rows = {
      w1: workspaceRow('w1', ['a']),
      w2: workspaceRow('w2', ['b']),
      wNew: workspaceRow('wNew', ['c']),
    };
    const services = liveServices({ ids: ['a', 'b', 'c'], workspaces: [rows.w1, rows.w2] });
    const { face } = mount(services);

    services.refuseInsert(true);
    face.togglePinWorkspace('w2');
    await settle();

    assert.equal(
      face.hooks.waState.getSnapshot().notice.title,
      'notice.pinFailedTitle',
      'a refused pin must explain itself instead of looking dead',
    );
    assert.deepEqual(face.hooks.waPins.getSnapshot(), [], 'a pin the Host refused must not be committed');
    assert.equal(storage.entries.has(PIN_STORAGE_KEY), false, 'nothing may be persisted for a refused pin');

    /* Once a pin exists, a refused DRIFT repair must not loop: the same target
       is refused once, and a repeat of the same drift adds no further calls. */
    services.refuseInsert(false);
    face.togglePinWorkspace('w2');
    await settle();
    const afterPin = services.insertCalls.length;

    services.refuseInsert(true);
    services.publish([rows.wNew, rows.w2, rows.w1]);
    await settle();
    assert.equal(services.insertCalls.length, afterPin + 1, 'the refused repair runs once');
    services.publish([rows.wNew, rows.w2, rows.w1]);
    await settle();
    assert.equal(services.insertCalls.length, afterPin + 1, 'the same refused target is never retried in a loop');
  } finally {
    storage.restore();
  }
});

test('apply: pinning still works where localStorage is unavailable', async () => {
  const services = liveServices({
    ids: ['a', 'b'],
    workspaces: [workspaceRow('w1', ['a']), workspaceRow('w2', ['b'])],
  });
  const { face } = mount(services);

  assert.equal(typeof localStorage, 'undefined', 'this test must run without a storage stub');
  face.togglePinWorkspace('w2');
  await settle();

  assert.deepEqual(services.insertCalls, [['w2', 'w1']], 'the durable reorder must not depend on the pin cache');
  assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w2'], 'the in-memory set still tracks the pin');
});

test('apply: a build without the reorder verb hides the pin control and says why', () => {
  const services = liveServices({ ids: ['a'], pinSupported: false });
  const { face, registrationById, seat } = mount(services);
  assert.equal(face.pinSupported, false);

  face.togglePinWorkspace('w1');
  assert.equal(face.hooks.waState.getSnapshot().notice.title, 'notice.pinUnsupportedTitle');
  assert.deepEqual(face.hooks.waPins.getSnapshot(), []);

  const pinRow = registrationById(PIN_MENU_ID);
  assert.ok(pinRow !== undefined, 'the pin row is registered even on a build that cannot use it');
  const rendered = flattenTree(
    pinRow.component(seat({ ...face, sessionId: 'a', useMenuOpenState: () => [true, () => {}] })),
  );
  assert.equal(rendered.length, 0, 'no pin row may render on a build that cannot reorder');
});

test('page: clicking the pin control reorders the workspace and flips the control', async () => {
  const storage = stubStorage();
  try {
    const services = liveServices({
      ids: ['a', 'b'],
      workspaces: [workspaceRow('w1', ['a']), workspaceRow('w2', ['b'])],
    });
    const { face, registrationOf, seat } = mount(services);
    const panelInjected = registrationOf('main').options.inject();
    const pinButtons = () =>
      flattenTree(registrationOf('main').component(seat(panelInjected))).filter(
        (element) => element.type === 'button' && element.props['aria-pressed'] !== undefined,
      );

    const before = pinButtons();
    assert.equal(before.length, 2, 'each real workspace group must carry a pin control');
    assert.deepEqual(
      before.map((element) => element.props.children),
      ['group.pin', 'group.pin'],
      'an unpinned group offers 置顶',
    );

    const w2Button = before[1];
    w2Button.props.onClick();
    await settle();

    assert.deepEqual(services.insertCalls, [['w2', 'w1']]);
    assert.deepEqual(services.workspaceIds(), ['w2', 'w1'], 'the panel pin must reorder the same list the sidebar reads');
    const after = pinButtons();
    assert.deepEqual(
      after.map((element) => element.props.children),
      ['group.unpin', 'group.pin'],
      'the pinned group switches to 取消置顶',
    );
    assert.equal(after[0].props['aria-pressed'], 'true');
    assert.ok(
      flattenTree(registrationOf('main').component(seat(panelInjected))).some(
        (element) => element.props.children === 'group.pinnedTag',
      ),
      'the pinned group must show its 已置顶 tag',
    );
    assert.deepEqual(face.hooks.waPins.getSnapshot(), ['w2']);
  } finally {
    storage.restore();
  }
});

test('menu: the pin row names the owning workspace and toggles it', async () => {
  const storage = stubStorage();
  try {
    const services = liveServices({
      ids: ['a', 'b'],
      workspaces: [workspaceRow('w1', ['a']), workspaceRow('w2', ['b'])],
    });
    const { registrationById, seat } = mount(services);
    const menu = registrationById(PIN_MENU_ID);
    assert.ok(menu !== undefined, 'apply() must register the pin row under its own slot id');
    const render = (face) =>
      flattenTree(menu.component(seat({ ...face, sessionId: 'b', useMenuOpenState: () => [true, () => {}] }))).find(
        (element) => element.props.role === 'menuitem',
      );

    const pinRow = render(menu.options.inject());
    assert.ok(pinRow !== undefined, 'a session row menu must offer the workspace pin');
    assert.equal(pinRow.props.children, 'menu.pinWorkspace');

    pinRow.props.onClick();
    await settle();

    assert.deepEqual(services.insertCalls, [['w2', 'w1']], 'the menu row must pin the owning workspace');
    assert.equal(render(menu.options.inject()).props.children, 'menu.unpinWorkspace', 'the row flips once pinned');
  } finally {
    storage.restore();
  }
});

/* ---------------------------------------------------------------------- *
 * partitionWorkspace
 * ---------------------------------------------------------------------- */

test('partitionWorkspace: splits a mixed group into pending/archived/blank, keeping input order', (t) => {
  const byId = {
    alpha: { blank: false },
    bravo: { blank: true },
    charlie: { blank: false },
    delta: { blank: false },
  };
  const archivedSet = new Set(['charlie', 'delta']);

  // Deliberately out of alphabetical order so a sort would show up as a diff.
  const result = partitionWorkspace(['delta', 'bravo', 'alpha', 'charlie'], byId, archivedSet);

  assert.deepEqual(result.pending, ['alpha']);
  assert.deepEqual(result.archived, ['delta', 'charlie']);
  assert.deepEqual(result.blank, ['bravo']);

  t.diagnostic(`partitionWorkspace returns keys: ${Object.keys(result).join(', ')}`);
});

test('partitionWorkspace: an empty group yields three empty buckets', () => {
  const result = partitionWorkspace([], {}, new Set());
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.archived, []);
  assert.deepEqual(result.blank, []);
});

test('partitionWorkspace: an id missing from byId is an ordinary pending target', () => {
  const byId = { known: { blank: false } };
  const result = partitionWorkspace(['known', 'ghost'], byId, new Set());
  assert.deepEqual(result.pending, ['known', 'ghost']);
  assert.deepEqual(result.archived, []);
  assert.deepEqual(result.blank, []);
});

test('partitionWorkspace: an archived blank remains available to restore', () => {
  const byId = { blankOne: { blank: true } };
  const result = partitionWorkspace(['blankOne'], byId, new Set(['blankOne']));
  assert.deepEqual(result.blank, []);
  assert.deepEqual(result.archived, ['blankOne']);
  assert.deepEqual(result.pending, []);
});

test('partitionWorkspace: a summary missing from byId still honours the archived set', () => {
  // Decided semantics: the registry's archived set is authoritative and a row
  // missing from the Client projection must not be read back as "not archived".
  const result = partitionWorkspace(['x'], {}, new Set(['x']));
  assert.deepEqual(result.archived, ['x']);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.blank, []);
});

test('partitionWorkspace: a subagent child is dropped from every bucket and from members', () => {
  // Subagent children are invisible in the browser and belong to their parent,
  // so a batch must neither archive them nor list them.
  const result = partitionWorkspace(['s'], { s: { origin: 'subagent' } }, new Set());
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.archived, []);
  assert.deepEqual(result.blank, []);
  assert.deepEqual(result.members, []);
});

/* ---------------------------------------------------------------------- *
 * ungroupedSessionIds
 * ---------------------------------------------------------------------- */

test('ungroupedSessionIds: returns ids no workspace accounts for, in input order', () => {
  const workspaces = [{ sessionIds: ['a', 'b'] }, { sessionIds: ['c'] }];
  assert.deepEqual(ungroupedSessionIds(workspaces, ['b', 'x', 'c', 'y', 'a']), ['x', 'y']);
});

test('ungroupedSessionIds: with no workspaces every id is ungrouped', () => {
  assert.deepEqual(ungroupedSessionIds([], ['a', 'b', 'c']), ['a', 'b', 'c']);
});

test('ungroupedSessionIds: a repeated id is reported once', () => {
  const workspaces = [{ sessionIds: ['a'] }];
  assert.deepEqual(ungroupedSessionIds(workspaces, ['x', 'y', 'x', 'a', 'y']), ['x', 'y']);
});

/* ---------------------------------------------------------------------- *
 * isActiveRefusal
 * ---------------------------------------------------------------------- */

/**
 * Build the refusal the Host raises: an Error whose `name` and `rpcError`
 * carry the class identity and business code (client bundles do not share
 * error-class identity, so the name is the only usable discriminator).
 * @param code - the RPC error code to attach.
 * @returns the shaped Error.
 */
function refusalWithCode(code) {
  const error = new Error('session still has running work');
  error.name = 'WorkspaceArchiveError';
  error.rpcError = { code, details: { activity: ['turn'] } };
  return error;
}

test('isActiveRefusal: true for the WorkspaceArchiveError + workspace/session-active pair', () => {
  assert.equal(isActiveRefusal(refusalWithCode('workspace/session-active')), true);
});

test('isActiveRefusal: false for ordinary errors, null, undefined, and other codes', (t) => {
  assert.equal(isActiveRefusal(new Error('boom')), false);
  assert.equal(isActiveRefusal(null), false);
  assert.equal(isActiveRefusal(undefined), false);

  const namedWithoutRpc = new Error('no rpcError');
  namedWithoutRpc.name = 'WorkspaceArchiveError';
  assert.equal(isActiveRefusal(namedWithoutRpc), false);

  assert.equal(isActiveRefusal(refusalWithCode('workspace/session-inactive')), false);

  /* The frozen contract sketches the positive case as a bare `{ name, rpcError }`
     literal; the artifact — like the shipped dsh-client-ui-workspace detection
     it mirrors — gates on `instanceof Error` before reading the name, so a plain
     object reads as "not a refusal". Recorded as an observation rather than an
     assertion, so the suite neither hides the difference nor pins a reading the
     contract did not settle. */
  const plainObject = { name: 'WorkspaceArchiveError', rpcError: { code: 'workspace/session-active' } };
  t.diagnostic(`plain-object refusal shape -> ${String(isActiveRefusal(plainObject))} (real Error -> true)`);
});

/* ---------------------------------------------------------------------- *
 * summarizeRun
 * ---------------------------------------------------------------------- */

test('summarizeRun: a completed run reports every id accounted for', () => {
  const run = {
    total: 5,
    done: 5,
    archivedIds: ['a', 'b', 'c', 'd', 'e'],
    stoppedIds: [],
    skippedRunning: [],
    failed: [],
  };
  assert.deepEqual(summarizeRun(run), { archived: 5, stopped: 0, skipped: 0, failed: 0, remaining: 0 });
});

test('summarizeRun: a cancelled run keeps the unreached work as remaining', () => {
  const run = {
    total: 10,
    done: 4,
    cancelled: true,
    archivedIds: ['a', 'b'],
    stoppedIds: ['c'],
    skippedRunning: ['d'],
    failed: [],
  };
  assert.deepEqual(summarizeRun(run), { archived: 2, stopped: 1, skipped: 1, failed: 0, remaining: 6 });
});

test('summarizeRun: remaining never goes negative', () => {
  const run = {
    total: 2,
    done: 5,
    archivedIds: ['a', 'b', 'c'],
    stoppedIds: ['d'],
    skippedRunning: ['e'],
    failed: [],
  };
  assert.deepEqual(summarizeRun(run), { archived: 3, stopped: 1, skipped: 1, failed: 0, remaining: 0 });
});

/* ---------------------------------------------------------------------- *
 * formatRelative
 * ---------------------------------------------------------------------- */

/** Fixed clock so the boundary arithmetic is exact. */
const NOW = 1_700_000_000_000;

/**
 * Format an instant that sits `delta` milliseconds before NOW.
 * @param delta - age in milliseconds.
 * @returns the formatted bucket.
 */
function ago(delta) {
  return formatRelative(NOW - delta, NOW);
}

test('formatRelative: under a minute is "now" with count 0', () => {
  assert.deepEqual(ago(0), { unit: 'now', count: 0 });
  assert.deepEqual(ago(30_000), { unit: 'now', count: 0 });
  assert.deepEqual(ago(59_999), { unit: 'now', count: 0 });
});

test('formatRelative: exactly one minute switches to minutes', () => {
  assert.deepEqual(ago(60_000), { unit: 'minutes', count: 1 });
  assert.deepEqual(ago(5 * 60_000), { unit: 'minutes', count: 5 });
});

test('formatRelative: exactly one hour switches to hours', () => {
  assert.deepEqual(ago(3_600_000), { unit: 'hours', count: 1 });
  assert.deepEqual(ago(2 * 3_600_000), { unit: 'hours', count: 2 });
});

test('formatRelative: exactly one day switches to days', () => {
  assert.deepEqual(ago(86_400_000), { unit: 'days', count: 1 });
  assert.deepEqual(ago(3 * 86_400_000), { unit: 'days', count: 3 });
});

test('formatRelative: a future timestamp reads as "now" instead of a negative count', () => {
  assert.deepEqual(formatRelative(NOW + 5_000, NOW), { unit: 'now', count: 0 });
});
