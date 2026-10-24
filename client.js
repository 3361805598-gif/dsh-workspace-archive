/**
 * Client half of the workspace-archive bundle.
 *
 * The Host ships archive as a **per-Session** verb (a row's hover button and
 * "..." menu row). This plugin adds the missing aggregate: archive or restore
 * every Session a Workspace accounts for, in one action. It also adds the
 * Workspace-level pin the Host does not have: a pinned Workspace leads the
 * sidebar list, and that order is kept whenever something displaces it.
 *
 * Five surfaces, all ordinary slot contributions:
 *
 * - `sidebar.panellist` icon + the `main` panel keyed by the same id: the
 *   batch management page, whose workspace rows also carry the pin control.
 * - `sidebar.workspaces.session.menu.item` twice: a one-click "archive this
 *   whole Workspace" row and a "pin this Workspace" row, both beside the
 *   shipped per-Session rows.
 * - `shell.overlay`: the confirmation, progress, and result layer, driven by a
 *   plugin-owned observable so it works from either entry point and survives
 *   the panel being switched away.
 *
 * Deliberate constraints: only `react` comes from the browser module table — no
 * Harness Client package is imported, so a host upgrade cannot break this file
 * at load time; styles are component-local `<style>` elements over
 * `--dsw-alias-*` tokens; nothing is appended to the page body and no other
 * plugin's DOM is read.
 *
 * Every archive write goes through `ctx.uiWorkspace.archiveSession` /
 * `unarchiveSession`, the Client face that also clears the main view when the
 * archived Session is the current selection. Every pin write goes through
 * `ctx.workspaces.insertBefore`, the same durable reorder the shipped sidebar
 * drag performs.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-workspace-archive',
  factory(require) {
    /** Browser module table: React is baseline; nothing else is requested. */
    const React = require('react');
    const h = React.createElement;
    const { Fragment, useCallback, useEffect, useMemo, useRef, useState } = React;

    /* ------------------------------------------------------------------ *
     * Identity and placement constants
     * ------------------------------------------------------------------ */

    /** Locale namespace this plugin owns. */
    const NS = 'dsh-workspace-archive';
    /** Id shared by the sidebar icon and the main panel it opens. */
    const PANEL_ID = 'workspace-archive';
    /** Session row menu entry id (package-namespaced, per the slot contract). */
    const MENU_ID = 'workspace-archive.archive-workspace';
    /** Session row menu entry id of the workspace pin row. */
    const PIN_MENU_ID = 'workspace-archive.pin-workspace';
    /** Overlay entry id. */
    const OVERLAY_ID = 'workspace-archive.dialog';
    /** Sidebar icon order: after the shipped `plugins` entry (order 0). */
    const PANEL_ORDER = 20;
    /** Overlay order: after the shipped row toasts. */
    const OVERLAY_ORDER = 100;
    /** Menu row order: after the shipped `archive` row (order 400). */
    const MENU_ORDER = 450;
    /** Pin menu row order: after the shipped rows, before our archive row. */
    const PIN_MENU_ORDER = 440;
    /** localStorage key holding the durable pin order (most recently pinned first). */
    const PIN_STORAGE_KEY = 'dsh.workspace-archive.pinned-workspaces';
    /** Stored payload version; an unknown version is ignored rather than guessed. */
    const PIN_STORAGE_VERSION = 1;
    /** Upper bound on remembered pins, so a corrupt payload cannot bloat the state. */
    const PIN_LIMIT = 200;
    /** Relative-time refresh cadence for the page. */
    const CLOCK_INTERVAL_MS = 60_000;

    /* ------------------------------------------------------------------ *
     * Copy: Simplified Chinese is the key source, English mirrors it
     * ------------------------------------------------------------------ */

    const zh = {
      panel: '工作区归档',
      'page.title': '工作区归档',
      'page.intro': '按工作区批量归档或恢复会话。全部实际会话归档后，整个工作区会从侧栏隐藏；在这里恢复任一会话即可重新显示。记录和目录都会保留。',
      'page.loading': '正在读取工作区…',
      'page.empty': '还没有注册任何工作区。先在侧边栏添加一个工作区，这里就会出现它的会话。',
      'page.expandAll': '展开全部',
      'page.collapseAll': '折叠全部',
      'page.summary': '共 {workspaces} 个工作区 · {sessions} 个会话 · 已归档 {archived} 个',
      'group.ungrouped': '未分组',
      'group.ungroupedHint': '不属于任何工作区的会话',
      'group.counts': '共 {total} · 待归档 {pending} · 已归档 {archived}',
      'group.archiveAll': '归档全部',
      'group.restoreAll': '恢复全部',
      'group.archiveAllHint': '归档这个范围里全部可归档的会话（会先确认）',
      'group.archiveAllIdle': '这个范围里没有可归档的会话',
      'group.restoreAllHint': '恢复这个范围里全部已归档的会话（无需确认）',
      'group.restoreAllIdle': '这个范围里没有已归档的会话',
      'group.expand': '展开 {name}',
      'group.collapse': '折叠 {name}',
      'group.empty': '这个分组里没有可处理的会话。',
      'group.pin': '置顶',
      'group.unpin': '取消置顶',
      'group.pinHint': '把这个工作区排到列表最前；顺序被打乱时会自动恢复',
      'group.unpinHint': '取消置顶，落到置顶区之后的第一个位置',
      'group.pinnedTag': '已置顶',
      'group.hiddenTag': '已从侧栏隐藏',
      'row.newSession': '新会话（空白）',
      'row.untitled': '未命名会话',
      'row.archivedTag': '已归档',
      'row.blankTag': '空白',
      'row.running': '运行中',
      'row.archive': '归档',
      'row.restore': '恢复',
      'row.archiveOne': '归档会话 {name}',
      'row.restoreOne': '恢复会话 {name}',
      'row.open': '打开会话 {name}',
      'menu.archiveWorkspace': '归档本工作区全部会话（{count}）',
      'menu.pinWorkspace': '置顶本工作区',
      'menu.unpinWorkspace': '取消置顶本工作区',
      'dialog.archiveTitle': '归档「{name}」',
      'dialog.ungroupedTitle': '归档未分组的会话',
      'dialog.archiveBody': '将归档 {count} 个会话。全部实际会话归档后，整个工作区会从侧栏隐藏，可在「工作区归档」面板恢复。运行中被跳过或失败的会话会让工作区继续显示。',
      'dialog.blankNote': '另有 {count} 个空白会话不参与批量归档；它们不会阻止已归档工作区从侧栏隐藏。',
      'dialog.stopRunning': '同时停止运行中的会话',
      'dialog.stopRunningHint': '开启后，正在进行的回复、子任务、后台任务与定时任务会先被停止，然后再归档。',
      'dialog.cancel': '取消',
      'dialog.confirmArchive': '归档 {count} 个',
      'dialog.progressTitle': '正在处理',
      'dialog.progress': '已处理 {done}/{total}',
      'dialog.progressHint': '可以切换到别的面板，处理会继续；结果会显示在浮层里。',
      'dialog.cancelRun': '取消剩余',
      'dialog.resultArchiveTitle': '归档完成',
      'dialog.resultUnarchiveTitle': '恢复完成',
      'dialog.resultCounts': '成功 {done} · 跳过（运行中）{skipped} · 失败 {failed}',
      'dialog.resultCancelled': '已取消，剩余 {remaining} 个未处理。',
      'dialog.failedHead': '失败明细',
      'dialog.stopAndArchive': '停止并归档这 {count} 个',
      'dialog.undoArchive': '恢复本次归档的 {count} 个',
      'dialog.close': '关闭',
      'notice.nothingTitle': '无需操作',
      'notice.allArchived': '这个范围里的会话都已归档。',
      'notice.noneArchived': '这个范围里没有已归档的会话。',
      'notice.noWorkspace': '这个会话不属于任何工作区，无法按工作区归档。',
      'notice.failedTitle': '操作失败',
      'notice.pinFailedTitle': '置顶失败',
      'notice.pinUnsupportedTitle': '无法置顶',
      'notice.pinUnsupported': '当前 DSH 版本没有提供工作区重排接口，置顶不可用。',
      'notice.notReadyTitle': '工作区尚未就绪',
      'notice.notReady': '工作区列表还在加载，请稍后再试。',
      'notice.dismiss': '知道了',
      'time.now': '刚刚',
      'time.minutes': '{count} 分钟前',
      'time.hours': '{count} 小时前',
      'time.days': '{count} 天前',
    };

    const en = {
      panel: 'Workspace archive',
      'page.title': 'Workspace archive',
      'page.intro': 'Archive or restore a whole workspace at once. Once all conversations are archived, the workspace is hidden from the sidebar. Restore a conversation here to show it again. Logs and directories are kept.',
      'page.loading': 'Reading workspaces…',
      'page.empty': 'No workspace is registered yet. Add one from the sidebar and its sessions appear here.',
      'page.expandAll': 'Expand all',
      'page.collapseAll': 'Collapse all',
      'page.summary': '{workspaces} workspaces · {sessions} sessions · {archived} archived',
      'group.ungrouped': 'Ungrouped',
      'group.ungroupedHint': 'Sessions outside every workspace',
      'group.counts': '{total} total · {pending} to archive · {archived} archived',
      'group.archiveAll': 'Archive all',
      'group.restoreAll': 'Restore all',
      'group.archiveAllHint': 'Archive every archivable session in this scope (asks first)',
      'group.archiveAllIdle': 'No session in this scope can be archived',
      'group.restoreAllHint': 'Restore every archived session in this scope (no confirmation)',
      'group.restoreAllIdle': 'No session in this scope is archived',
      'group.expand': 'Expand {name}',
      'group.collapse': 'Collapse {name}',
      'group.empty': 'Nothing to process in this group.',
      'group.pin': 'Pin to top',
      'group.unpin': 'Unpin',
      'group.pinHint': 'Keep this workspace at the top of the list; the order is restored whenever it drifts',
      'group.unpinHint': 'Unpin it and drop it just below the pinned block',
      'group.pinnedTag': 'Pinned',
      'group.hiddenTag': 'Hidden from sidebar',
      'row.newSession': 'New session (blank)',
      'row.untitled': 'Untitled session',
      'row.archivedTag': 'Archived',
      'row.blankTag': 'Blank',
      'row.running': 'Running',
      'row.archive': 'Archive',
      'row.restore': 'Restore',
      'row.archiveOne': 'Archive session {name}',
      'row.restoreOne': 'Restore session {name}',
      'row.open': 'Open session {name}',
      'menu.archiveWorkspace': 'Archive all sessions of this workspace ({count})',
      'menu.pinWorkspace': 'Pin this workspace to the top',
      'menu.unpinWorkspace': 'Unpin this workspace',
      'dialog.archiveTitle': 'Archive “{name}”',
      'dialog.ungroupedTitle': 'Archive ungrouped sessions',
      'dialog.archiveBody': '{count} sessions will be archived. Once all conversations are archived, the workspace is hidden from the sidebar and can be restored here. Skipped or failed sessions keep it visible.',
      'dialog.blankNote': '{count} blank sessions are left out of the batch; they do not keep an archived workspace visible in the sidebar.',
      'dialog.stopRunning': 'Also stop sessions that are running',
      'dialog.stopRunningHint': 'When on, in-flight replies, subagents, background jobs, and schedules are stopped first, then archived.',
      'dialog.cancel': 'Cancel',
      'dialog.confirmArchive': 'Archive {count}',
      'dialog.progressTitle': 'Working',
      'dialog.progress': '{done}/{total} processed',
      'dialog.progressHint': 'You can switch panels; the run continues and its result appears in this layer.',
      'dialog.cancelRun': 'Cancel remaining',
      'dialog.resultArchiveTitle': 'Archive finished',
      'dialog.resultUnarchiveTitle': 'Restore finished',
      'dialog.resultCounts': '{done} succeeded · {skipped} skipped (running) · {failed} failed',
      'dialog.resultCancelled': 'Cancelled with {remaining} left unprocessed.',
      'dialog.failedHead': 'Failures',
      'dialog.stopAndArchive': 'Stop and archive these {count}',
      'dialog.undoArchive': 'Restore the {count} archived by this run',
      'dialog.close': 'Close',
      'notice.nothingTitle': 'Nothing to do',
      'notice.allArchived': 'Every session in this scope is already archived.',
      'notice.noneArchived': 'No session in this scope is archived.',
      'notice.noWorkspace': 'This session belongs to no workspace, so it cannot be archived by workspace.',
      'notice.failedTitle': 'Action failed',
      'notice.pinFailedTitle': 'Pin failed',
      'notice.pinUnsupportedTitle': 'Cannot pin',
      'notice.pinUnsupported': 'This DSH build exposes no workspace reorder call, so pinning is unavailable.',
      'notice.notReadyTitle': 'Workspaces not ready',
      'notice.notReady': 'The workspace list is still loading; try again in a moment.',
      'notice.dismiss': 'Got it',
      'time.now': 'just now',
      'time.minutes': '{count} min ago',
      'time.hours': '{count} h ago',
      'time.days': '{count} d ago',
    };

    /* ------------------------------------------------------------------ *
     * Pure helpers (also exported as `internals` for the unit tests)
     * ------------------------------------------------------------------ */

    /**
     * Partition a group's accounted Sessions into what a batch may archive,
     * what is already archived, and what the batch must leave alone.
     *
     * Two rules mirror the shipped browser instead of inventing new ones:
     * subagent children are never listed (the browser hides them, and they
     * belong to their parent's conversation), and the blank Session is the
     * workspace's reusable "New session" placeholder, so a workspace-wide
     * batch leaves it alone — the expanded list still offers it one by one.
     *
     * A missing summary is treated as an ordinary, unarchived Session: the
     * Host decides, and a stale list must not silently drop a target.
     * @param sessionIds - accounted Session ids in the caller's order.
     * @param byId - Session summaries keyed by id.
     * @param archivedSet - registry-global archived Session ids.
     * @returns the three ordered buckets plus every listable member id.
     */
    function partitionWorkspace(sessionIds, byId, archivedSet) {
      const pending = [];
      const archived = [];
      const blank = [];
      const members = [];
      for (const id of sessionIds) {
        const summary = byId === undefined || byId === null ? undefined : byId[id];
        if (summary !== undefined && summary.origin === 'subagent') continue;
        members.push(id);
        if (archivedSet.has(id)) archived.push(id);
        else if (summary !== undefined && summary.blank === true) blank.push(id);
        else pending.push(id);
      }
      return { pending, archived, blank, members };
    }

    /** Derive hidden workspaces from durable archive state, including old archives. */
    function archivedWorkspaceIds(workspaces, byId, archivedIds) {
      const archived = new Set(archivedIds);
      return workspaces.filter((workspace) => {
        let hasHistory = false;
        for (const id of workspace.sessionIds) {
          const summary = byId[id];
          if (summary === undefined) return false;
          if (summary.origin === 'subagent' || summary.blank === true) continue;
          hasHistory = true;
          if (!archived.has(id)) return false;
        }
        return hasHistory;
      }).map((workspace) => workspace.workspaceId);
    }

    /** Filter both snapshots so hidden sessions cannot reappear under Ungrouped. */
    function sidebarSnapshots(workspaces, sessions) {
      if (workspaces.phase !== 'ready' || sessions.phase !== 'ready') {
        return { workspaces, sessions, hiddenSessionIds: new Set() };
      }
      const hidden = new Set(archivedWorkspaceIds(workspaces.items, sessions.byId, workspaces.archivedSessionIds));
      const hiddenSessionIds = new Set();
      for (const workspace of workspaces.items) {
        if (hidden.has(workspace.workspaceId)) {
          for (const id of workspace.sessionIds) hiddenSessionIds.add(id);
        }
      }
      if (hidden.size === 0) return { workspaces, sessions, hiddenSessionIds };
      return {
        workspaces: { ...workspaces, items: workspaces.items.filter((item) => !hidden.has(item.workspaceId)) },
        sessions: {
          ...sessions,
          ids: sessions.ids.filter((id) => !hiddenSessionIds.has(id)),
          byId: Object.fromEntries(Object.entries(sessions.byId).filter(([id]) => !hiddenSessionIds.has(id))),
        },
        hiddenSessionIds,
      };
    }

    /**
     * Session ids no Workspace accounts for — the sidebar's "Ungrouped"
     * bucket. Subagent children land here too (no Workspace accounts for
     * them); {@link partitionWorkspace} removes them from each group.
     * @param workspaces - authoritative Workspace rows.
     * @param ids - every Session id the Client list knows.
     * @returns the unaccounted ids in list order, without duplicates.
     */
    function ungroupedSessionIds(workspaces, ids) {
      const accounted = new Set();
      for (const workspace of workspaces) for (const id of workspace.sessionIds) accounted.add(id);
      const out = [];
      const seen = new Set();
      for (const id of ids) {
        if (accounted.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out;
    }

    /**
     * Whether one archive rejection is the Host's "this Session still has
     * running work" refusal. Mirrors the shipped detection exactly: the Client
     * error class name plus the stable business code.
     * @param error - the rejection value.
     * @returns true when the Host refused because work still runs.
     */
    function isActiveRefusal(error) {
      if (!(error instanceof Error) || error.name !== 'WorkspaceArchiveError') return false;
      const rpcError = error.rpcError;
      return rpcError !== undefined && rpcError !== null && rpcError.code === 'workspace/session-active';
    }

    /**
     * Counts the result layer and its copy need from a finished run.
     * `archived` counts every successfully processed id, so it also reads as
     * "restored" on an unarchive run.
     * @param run - the run record.
     * @returns processed, stopped, skipped, failed, and remaining counts.
     */
    function summarizeRun(run) {
      return {
        archived: run.archivedIds.length,
        stopped: run.stoppedIds.length,
        skipped: run.skippedRunning.length,
        failed: run.failed.length,
        remaining: Math.max(0, run.total - run.done),
      };
    }

    /**
     * Bucket one update instant for a row's relative-time label.
     * @param updatedAt - epoch milliseconds.
     * @param now - current epoch milliseconds.
     * @returns a unit key with its count; `now` carries count 0.
     */
    function formatRelative(updatedAt, now) {
      const delta = now - updatedAt;
      if (!Number.isFinite(delta) || delta < 60_000) return { unit: 'now', count: 0 };
      const minutes = Math.floor(delta / 60_000);
      if (minutes < 60) return { unit: 'minutes', count: minutes };
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return { unit: 'hours', count: hours };
      return { unit: 'days', count: Math.floor(hours / 24) };
    }

    /**
     * Message text of an arbitrary rejection.
     * @param error - the rejection value.
     * @returns a human-readable one-liner.
     */
    function messageOf(error) {
      if (error instanceof Error && typeof error.message === 'string' && error.message !== '') return error.message;
      if (typeof error === 'string' && error !== '') return error;
      return String(error);
    }

    /* ------------------------------------------------------------------ *
     * Workspace pins: pure helpers (also exported as `internals`)
     *
     * DSH pins Sessions natively but has no Workspace pin, so this plugin owns
     * the pin set and expresses it through the SAME durable reorder the shipped
     * sidebar drag uses. Everything below is pure: the move planner is the whole
     * algorithm, and the runner only executes its plan.
     * ------------------------------------------------------------------ */

    /**
     * Whether two id lists are identical, element by element.
     * @param left - first list.
     * @param right - second list.
     * @returns true when both lists are equal.
     */
    function sameIds(left, right) {
      return left.length === right.length && left.every((id, index) => id === right[index]);
    }

    /**
     * Keep the pins that still name a live Workspace, in pin order. A deleted
     * Workspace leaves its pin behind in storage, so every live order snapshot
     * prunes against the Workspace ids before anything reads the set.
     * @param pinnedIds - remembered pins; most recently pinned first.
     * @param liveIds - Workspace ids the Client list currently holds.
     * @returns the surviving pins, deduped and capped at PIN_LIMIT.
     */
    function prunePins(pinnedIds, liveIds) {
      const live = new Set(liveIds);
      const out = [];
      for (const id of pinnedIds) {
        if (!live.has(id) || out.includes(id)) continue;
        out.push(id);
        if (out.length >= PIN_LIMIT) break;
      }
      return out;
    }

    /**
     * The pinned block that must lead an order: the remembered pins that still
     * name a live Workspace, in pin order (most recently pinned first).
     * @param order - Workspace ids in authoritative display order.
     * @param pinnedIds - remembered pins.
     * @returns the leading ids, in the order they must appear.
     */
    function desiredLead(order, pinnedIds) {
      const present = new Set(order);
      return pinnedIds.filter((id) => present.has(id));
    }

    /**
     * Whether an order already starts with the pinned block.
     * @param order - Workspace ids in display order.
     * @param lead - the block that must lead.
     * @returns true when nothing has to move.
     */
    function leadSatisfied(order, lead) {
      return lead.every((id, index) => order[index] === id);
    }

    /**
     * Plan the moves that put the pinned block first, mirroring the Host's
     * DOM-insertBefore-like semantics: remove the Workspace, then insert it
     * before its anchor, or append when no anchor is left. Working on a copy
     * keeps this pure, and only a move that really changes the order is
     * returned — an already-correct order yields an empty plan, and a plan for
     * a drifted order never reshuffles the unpinned Workspaces.
     * @param order - current Workspace ids in display order.
     * @param lead - the pinned ids that must lead, in their required order.
     * @returns `[workspaceId, anchorId | undefined]` pairs, applied bottom-up.
     */
    function planPinMoves(order, lead) {
      const moves = [];
      let working = order.slice();
      for (let index = lead.length - 1; index >= 0; index -= 1) {
        const id = lead[index];
        const anchor =
          index === lead.length - 1 ? working.find((candidate) => !lead.includes(candidate)) : lead[index + 1];
        const without = working.filter((candidate) => candidate !== id);
        const at = anchor === undefined ? without.length : without.indexOf(anchor);
        if (at === -1) continue;
        const next = [...without.slice(0, at), id, ...without.slice(at)];
        if (next.every((candidate, position) => candidate === working[position])) continue;
        working = next;
        moves.push([id, anchor]);
      }
      return moves;
    }

    /**
     * Read a persisted pin payload. An unknown version, a malformed value, or a
     * non-string entry yields an empty list instead of a guess.
     * @param raw - the stored string, or null when nothing was stored yet.
     * @returns the pinned ids, most recently pinned first.
     */
    function readPins(raw) {
      if (typeof raw !== 'string' || raw === '') return [];
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return [];
      }
      if (parsed === null || typeof parsed !== 'object') return [];
      if (parsed.version !== PIN_STORAGE_VERSION || !Array.isArray(parsed.workspaceIds)) return [];
      const out = [];
      for (const id of parsed.workspaceIds) {
        if (typeof id !== 'string' || id === '' || out.includes(id)) continue;
        out.push(id);
        if (out.length >= PIN_LIMIT) break;
      }
      return out;
    }

    /**
     * Serialize the pin list for storage.
     * @param pinnedIds - pinned ids, most recently pinned first.
     * @returns the stored payload.
     */
    function writePins(pinnedIds) {
      return JSON.stringify({ version: PIN_STORAGE_VERSION, workspaceIds: pinnedIds });
    }

    /* ------------------------------------------------------------------ *
     * Observable state (getSnapshot/subscribe — the slot system's currency)
     * ------------------------------------------------------------------ */

    /** Idle state: nothing pending, nothing running, nothing to report. */
    const EMPTY_STATE = { pending: null, run: null, result: null, notice: null };

    /**
     * Create the plugin-owned snapshot source.
     * @param initial - the first snapshot.
     * @returns a source the inject face hands to the renderer.
     */
    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        getSnapshot() {
          return state;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        set(next) {
          if (next === state) return;
          state = next;
          for (const listener of Array.from(listeners)) listener();
        },
      };
    }

    /* ------------------------------------------------------------------ *
     * Batch runner and workspace pins: plugin-scope, lifetime-independent
     * ------------------------------------------------------------------ */

    /**
     * Build the single batch runner and its sibling pin controller. Together
     * they own the observables, compute targets from the live Client services at
     * request time, and write only through `ctx.uiWorkspace` and
     * `ctx.workspaces`. Living in the plugin scope is what lets a run survive
     * the panel being switched away — including the case where the archived
     * Session is the current selection, which clears the main view mid-run — and
     * what keeps the pin invariant true while no plugin surface is mounted.
     * @param ctx - the Client root context.
     * @returns the stores plus every action the surfaces drive.
     */
    function createRunner(ctx) {
      const store = createStore(EMPTY_STATE);
      let cancelRequested = false;

      /* Both services are hard `inject` dependencies, so they are guaranteed to
         exist before `apply` ever runs. Resolving them ONCE here — instead of
         reading `ctx.workspaces` inside every click handler — is what keeps an
         action from ever failing on service resolution. Cordis gates
         `ctx.<service>` on the fiber's `inject` declaration: an undeclared read
         throws `cannot get property "<name>" without inject`, which inside a
         React `onClick` is invisible and reads to the operator as a dead
         button. */
      const workspacesService = ctx.workspaces;
      const sessionsService = ctx.sessions;

      /* Notices originate in the runner, outside any component, so they cannot
         borrow the seat's `t` prop. Bind the namespace once; a missing
         dictionary degrades to the key rather than throwing. */
      const t = (() => {
        try {
          return ctx.locale.bind(NS);
        } catch (error) {
          return (key) => key;
        }
      })();

      /** Merge one patch into the state so a field is never dropped by accident. */
      function patch(next) {
        store.set({ ...store.getSnapshot(), ...next });
      }

      /**
       * Take the layer down to a single plain-language notice. Used for the two
       * cases that used to be indistinguishable from a broken plugin: an action
       * that has nothing left to do, and an unexpected failure.
       *
       * A run in flight owns the layer: while work is in progress the progress
       * card is the operator's only feedback, so a notice never displaces it
       * (the failure still reaches the console).
       * @param title - short line naming what was attempted.
       * @param message - what happened, in the operator's terms.
       */
      function notify(title, message) {
        if (store.getSnapshot().run !== null) return;
        patch({ pending: null, result: null, notice: { title, message } });
      }

      /* ------------------------------------------------------------------ *
       * Workspace pins
       *
       * A pinned Workspace has to LEAD the list — in the sidebar, not only in
       * this panel. DSH has no Workspace pin verb, so the plugin keeps the pin
       * set and enforces it through `workspaces.insertBefore`, the same durable
       * reorder the shipped sidebar drag calls. The set lives in localStorage
       * because the Host has no slot for it; the ORDER it produces is
       * Host-persisted either way, so every Client shows it.
       * ------------------------------------------------------------------ */

      /** Runtime probe: a build without the reorder verb hides every pin control. */
      const pinSupported = typeof workspacesService.insertBefore === 'function';
      const pinsStore = createStore(loadPinnedIds());
      /** Workspaces with a toggle in flight, so a double click cannot reorder twice. */
      const pinBusy = new Set();
      /** Serializes toggle tasks, so two quick clicks never compute from one stale set. */
      let pinQueue = Promise.resolve();
      /** Order writes in flight: one planner owns the list at a time. */
      let pinWrites = 0;
      /** Plan signature being written right now, and the last one the Host refused. */
      let pinApplying = null;
      let pinRefused = null;
      let pinReconcilePending = false;

      /** Read the persisted pin list; unavailable or corrupt storage degrades to an empty set. */
      function loadPinnedIds() {
        try {
          if (typeof localStorage === 'undefined') return [];
          return readPins(localStorage.getItem(PIN_STORAGE_KEY));
        } catch (error) {
          console.warn('[workspace-archive] pin state load failed:', error);
          return [];
        }
      }

      /** Persist the pin list; a refused or unavailable store is never fatal. */
      function savePinnedIds(pinnedIds) {
        try {
          if (typeof localStorage === 'undefined') return;
          localStorage.setItem(PIN_STORAGE_KEY, writePins(pinnedIds));
        } catch (error) {
          console.warn('[workspace-archive] pin state save failed:', error);
        }
      }

      /** Replace the pin set only when it really changed, then persist it. */
      function setPinnedIds(next) {
        if (sameIds(next, pinsStore.getSnapshot())) return;
        pinsStore.set(next);
        savePinnedIds(next);
      }

      /**
       * The Workspace ids in authoritative order, or undefined while the list is
       * still loading. Order is only meaningful in the ready phase: pruning
       * against a pending empty list would erase a persisted pin set.
       * @returns Workspace ids in display order, or undefined before readiness.
       */
      function liveOrder() {
        const snapshot = workspacesService.list.getSnapshot();
        if (snapshot.phase !== 'ready') return undefined;
        return snapshot.items.map((item) => item.workspaceId);
      }

      /**
       * Run one order-writing action under the single-writer lock. The Host
       * publishes a moved order the moment the call resolves, which is BEFORE a
       * user action has committed its pin set: a reconciliation pass at that
       * instant would read the old set and move the row straight back. The lock
       * is what keeps one planner owning the list at a time.
       * @param action - the order-writing action to run exclusively.
       * @returns the action's result.
       */
      async function withOrderLock(action) {
        pinWrites += 1;
        try {
          return await action();
        } finally {
          pinWrites -= 1;
        }
      }

      /**
       * Run one plan: each planned move through the Client face, in order.
       * @param moves - `[workspaceId, anchorId | undefined]` pairs from the planner.
       */
      async function applyPinMoves(moves) {
        for (const [id, anchor] of moves) await workspacesService.insertBefore(id, anchor);
      }

      /**
       * Repair the invariant: the pinned block leads. Idempotent by construction
       * — a satisfied order costs no call — and a target the Host refused is not
       * retried until something else changes, because the optimistic reorder
       * rolls back and would otherwise loop.
       * @param order - current Workspace ids in display order.
       */
      function reconcilePins(order) {
        if (!pinSupported) return;
        const lead = desiredLead(order, pinsStore.getSnapshot());
        if (lead.length === 0 || leadSatisfied(order, lead)) return;
        const signature = lead.join('\u0000');
        if (signature === pinRefused || signature === pinApplying) return;
        const moves = planPinMoves(order, lead);
        if (moves.length === 0) return;
        pinApplying = signature;
        void withOrderLock(async () => {
          try {
            await applyPinMoves(moves);
            pinRefused = null;
          } catch (error) {
            pinRefused = signature;
            notify(t('notice.pinFailedTitle'), messageOf(error));
          } finally {
            pinApplying = null;
          }
        });
      }

      /**
       * React to one Workspace order or membership change: drop pins whose
       * Workspace is gone, then re-assert the invariant. A burst of stream
       * frames coalesces into one microtask, the pass never mutates the state
       * from inside a subscriber notification, and a pass that lands while an
       * order write is in flight is dropped — that writer re-schedules one.
       */
      function schedulePinReconcile() {
        if (pinReconcilePending) return;
        pinReconcilePending = true;
        queueMicrotask(() => {
          pinReconcilePending = false;
          if (pinWrites > 0) return;
          const order = liveOrder();
          if (order === undefined) return;
          setPinnedIds(prunePins(pinsStore.getSnapshot(), order));
          reconcilePins(order);
        });
      }

      /**
       * Pin one Workspace: reach the target order under the lock, then commit
       * the set. The reorder IS the durable effect, so a refused reorder must
       * not leave behind a pin the sidebar does not honour.
       * @param workspaceId - the Workspace to pin.
       */
      async function pinWorkspace(workspaceId) {
        const order = liveOrder();
        if (order === undefined) {
          notify(t('notice.notReadyTitle'), t('notice.notReady'));
          return;
        }
        if (!order.includes(workspaceId)) {
          notify(t('notice.nothingTitle'), t('notice.noWorkspace'));
          return;
        }
        const pins = pinsStore.getSnapshot();
        if (pins.includes(workspaceId)) return;
        /* The newest pin leads the block; the first pin simply leads the list.
           The planner decides what actually has to move, so a row that already
           stands where the pin wants it costs no Host call at all. */
        const lead = desiredLead(order, [workspaceId, ...pins]);
        await withOrderLock(() => applyPinMoves(planPinMoves(order, lead)));
        /* A write just went through, so a target the Host refused earlier is
           worth trying again rather than staying permanently parked. */
        pinRefused = null;
        setPinnedIds([workspaceId, ...pins]);
        schedulePinReconcile();
      }

      /**
       * Unpin one Workspace: it lands just below the remaining pinned block, so
       * the block stays contiguous and the row never drops at an anchor the
       * operator cannot predict. The same planner runs the block repair, which
       * means an unpin also fixes a block that drifted while it was pinned.
       * @param workspaceId - the Workspace to unpin.
       */
      async function unpinWorkspace(workspaceId) {
        const pins = pinsStore.getSnapshot();
        if (!pins.includes(workspaceId)) return;
        const remaining = pins.filter((id) => id !== workspaceId);
        const order = liveOrder();
        if (order !== undefined) {
          const lead = desiredLead(order, [...remaining, workspaceId]);
          await withOrderLock(() => applyPinMoves(planPinMoves(order, lead)));
          pinRefused = null;
        }
        setPinnedIds(remaining);
        schedulePinReconcile();
      }

      /**
       * Operator entry: pin an unpinned Workspace, unpin a pinned one.
       *
       * Toggles are serialized through one chain and the set is re-read when a
       * task finally runs. Two quick clicks on two rows would otherwise both
       * compute from the same pre-commit set, and the second would overwrite the
       * first; a refused Host call stays visible either way.
       * @param workspaceId - the Workspace the control names.
       */
      function togglePinWorkspace(workspaceId) {
        if (!pinSupported) {
          notify(t('notice.pinUnsupportedTitle'), t('notice.pinUnsupported'));
          return;
        }
        if (pinBusy.has(workspaceId)) return;
        pinBusy.add(workspaceId);
        pinQueue = pinQueue
          .then(() => (pinsStore.getSnapshot().includes(workspaceId) ? unpinWorkspace(workspaceId) : pinWorkspace(workspaceId)))
          .catch((error) => notify(t('notice.pinFailedTitle'), messageOf(error)))
          .finally(() => {
            pinBusy.delete(workspaceId);
          });
      }

      /* The invariant is maintained by subscription, not by the panel being open:
         a Workspace created anywhere pushes the list down, and re-pinning has to
         happen while the operator is looking at the sidebar. */
      ctx.effect(
        () => {
          const unsubscribe = workspacesService.list.subscribe(schedulePinReconcile);
          schedulePinReconcile();
          return unsubscribe;
        },
        'workspace-archive: pin order',
      );

      /** Read the two authoritative snapshots at request time. */
      function liveState() {
        const workspaces = workspacesService.list.getSnapshot();
        const sessions = sessionsService.list.getSnapshot();
        return { archivedSet: new Set(workspaces.archivedSessionIds), byId: sessions.byId };
      }

      /** Targets of one scope, recomputed so a click never acts on stale data. */
      function targetsOf(sessionIds, kind) {
        const live = liveState();
        const part = partitionWorkspace(sessionIds, live.byId, live.archivedSet);
        return { part, targets: kind === 'archive' ? part.pending : part.archived };
      }

      /** One scope descriptor: what the confirm copy names and what it acts on. */
      function scopeOfWorkspace(workspaceId) {
        const workspaces = workspacesService.list.getSnapshot();
        const workspace = workspaces.items.find((item) => item.workspaceId === workspaceId);
        if (workspace === undefined) return undefined;
        return {
          key: workspace.workspaceId,
          title: workspace.title,
          path: workspace.path,
          sessionIds: workspace.sessionIds,
        };
      }

      /** The ungrouped bucket as a scope, or undefined when it holds nothing. */
      function scopeOfUngrouped() {
        const workspaces = workspacesService.list.getSnapshot();
        const sessions = sessionsService.list.getSnapshot();
        const sessionIds = ungroupedSessionIds(workspaces.items, sessions.ids);
        if (sessionIds.length === 0) return undefined;
        return { key: '', title: '', path: undefined, sessionIds };
      }

      /**
       * Run one batch. Sessions are processed one at a time through the Client
       * face: the Host serializes Workspace mutations anyway, and sequential
       * calls keep the progress count honest and let a cancel take effect
       * between two Sessions.
       * @param input - kind, targets, display title, and the stop-work flag.
       */
      async function startRun(input) {
        if (store.getSnapshot().run !== null) return;
        cancelRequested = false;
        const run = {
          kind: input.kind,
          title: input.title,
          stopRunning: input.stopRunning,
          total: input.targets.length,
          done: 0,
          archivedIds: [],
          stoppedIds: [],
          skippedRunning: [],
          failed: [],
          cancelled: false,
        };
        store.set({ pending: null, run: { ...run }, result: null, notice: null });
        for (const id of input.targets) {
          if (cancelRequested) {
            run.cancelled = true;
            break;
          }
          try {
            if (input.kind === 'archive') {
              await ctx.uiWorkspace.archiveSession(id, input.stopRunning ? { stopActivity: true } : undefined);
              if (input.stopRunning) run.stoppedIds.push(id);
              else run.archivedIds.push(id);
            } else {
              await ctx.uiWorkspace.unarchiveSession(id);
              run.archivedIds.push(id);
            }
          } catch (error) {
            /* The one expected refusal is "work still runs"; every other
               rejection (carrier fault, vanished Session) is reported with
               its own message instead of being swallowed. */
            if (input.kind === 'archive' && isActiveRefusal(error)) run.skippedRunning.push(id);
            else run.failed.push({ id, message: messageOf(error) });
          }
          run.done += 1;
          store.set({ pending: null, run: { ...run }, result: null, notice: null });
        }
        store.set({ pending: null, run: null, result: { ...run, at: Date.now() }, notice: null });
      }

      /**
       * Ask for confirmation before a batch archive. A no-op while a run is in
       * flight or when nothing is left to archive, so repeated clicks and a
       * stale panel row are both safe.
       * @param scope - the workspace or ungrouped bucket to archive.
       */
      function requestArchive(scope) {
        if (scope === undefined || store.getSnapshot().run !== null) return;
        const { part, targets } = targetsOf(scope.sessionIds, 'archive');
        if (targets.length === 0) {
          /* Say so: a batch with nothing left to do must not look like a dead
             button, which is exactly what an unexplained no-op reads as. */
          notify(t('notice.nothingTitle'), t('notice.allArchived'));
          return;
        }
        patch({
          pending: {
            kind: 'archive',
            title: scope.title,
            path: scope.path,
            targets,
            blankCount: part.blank.length,
          },
          run: null,
          result: null,
          notice: null,
        });
      }

      /**
       * Restore every archived Session of a scope. No confirmation: restoring
       * is idempotent and reversible by the same button pair, and the shipped
       * per-Session restore behaves the same way.
       * @param scope - the workspace or ungrouped bucket to restore.
       */
      function requestUnarchive(scope) {
        if (scope === undefined || store.getSnapshot().run !== null) return;
        const { targets } = targetsOf(scope.sessionIds, 'unarchive');
        if (targets.length === 0) {
          notify(t('notice.nothingTitle'), t('notice.noneArchived'));
          return;
        }
        void startRun({ kind: 'unarchive', targets, title: scope.title, stopRunning: false });
      }

      /**
       * Archive the whole Workspace a Session row belongs to.
       * @param sessionId - the row's Session.
       */
      function requestArchiveForSession(sessionId) {
        const workspaces = workspacesService.list.getSnapshot();
        const owner = workspaces.items.find((item) => item.sessionIds.includes(sessionId));
        if (owner === undefined) {
          notify(t('notice.nothingTitle'), t('notice.noWorkspace'));
          return;
        }
        requestArchive(scopeOfWorkspace(owner.workspaceId));
      }

      /** Archive the ungrouped bucket. */
      function requestArchiveUngrouped() {
        requestArchive(scopeOfUngrouped());
      }

      /** Drop a pending confirmation without acting on it. */
      function cancelPending() {
        if (store.getSnapshot().pending === null) return;
        patch({ pending: null });
      }

      /** Ask the current run to stop after the Session it is processing. */
      function cancelRun() {
        cancelRequested = true;
      }

      /** Take the result layer down. */
      function dismissResult() {
        if (store.getSnapshot().result === null) return;
        patch({ result: null });
      }

      /** Take the notice layer down. */
      function dismissNotice() {
        if (store.getSnapshot().notice === null) return;
        patch({ notice: null });
      }

      /**
       * Confirm the pending request and start the run.
       * @param stopRunning - ask the Host to stop each Session's work first.
       */
      function confirmPending(stopRunning) {
        const pending = store.getSnapshot().pending;
        if (pending === null) return;
        void startRun({
          kind: 'archive',
          targets: pending.targets,
          title: pending.title,
          stopRunning: stopRunning === true,
        });
      }

      /** Retry the Sessions the Host refused, this time stopping their work. */
      function archiveSkipped() {
        const state = store.getSnapshot();
        const result = state.result;
        if (result === null || state.run !== null || result.skippedRunning.length === 0) return;
        void startRun({
          kind: 'archive',
          targets: result.skippedRunning.slice(),
          title: result.title,
          stopRunning: true,
        });
      }

      /** Undo this run: restore everything it archived, stopped work included. */
      function undoResult() {
        const state = store.getSnapshot();
        const result = state.result;
        if (result === null || state.run !== null || result.kind !== 'archive') return;
        const targets = [...result.archivedIds, ...result.stoppedIds];
        if (targets.length === 0) return;
        void startRun({ kind: 'unarchive', targets, title: result.title, stopRunning: false });
      }

      /**
       * Wrap one operator action so no failure can be silent. The surfaces call
       * these from React event handlers, where an escaping throw is swallowed by
       * the error boundary and the control simply appears dead; catching here
       * turns every such defect into a visible, self-explaining notice.
       * @param label - the action name, shown when it fails.
       * @param action - the action to run.
       * @returns a wrapper with the same arguments and result.
       */
      function guarded(label, action) {
        return (...args) => {
          try {
            return action(...args);
          } catch (error) {
            console.error('[workspace-archive] ' + label + ' failed:', error);
            notify(t('notice.failedTitle'), messageOf(error));
            return undefined;
          }
        };
      }

      /* A transport reset invalidates the run's target snapshots: stop after
         the current Session and report the partial result honestly. */
      ctx.effect(
        () =>
          ctx.on('connection/reset', () => {
            if (store.getSnapshot().run !== null) cancelRequested = true;
          }),
        'workspace-archive: connection reset',
      );

      return {
        /**
         * The registration-local inject share handed to every surface. A fresh
         * object per registration; its action closures are stable.
         * @returns hooks plus the actions a surface may drive.
         */
        face() {
          return {
            hooks: { waState: store, waPins: pinsStore },
            pinSupported,
            requestArchive: guarded('requestArchive', requestArchive),
            requestArchiveForSession: guarded('requestArchiveForSession', requestArchiveForSession),
            requestArchiveUngrouped: guarded('requestArchiveUngrouped', requestArchiveUngrouped),
            requestUnarchive: guarded('requestUnarchive', requestUnarchive),
            confirmPending: guarded('confirmPending', confirmPending),
            cancelPending: guarded('cancelPending', cancelPending),
            cancelRun: guarded('cancelRun', cancelRun),
            dismissResult: guarded('dismissResult', dismissResult),
            dismissNotice: guarded('dismissNotice', dismissNotice),
            archiveSkipped: guarded('archiveSkipped', archiveSkipped),
            undoResult: guarded('undoResult', undoResult),
            togglePinWorkspace: guarded('togglePinWorkspace', togglePinWorkspace),
          };
        },
      };
    }

    /* ------------------------------------------------------------------ *
     * Styles: own prefix, host tokens only, rendered as React elements
     * ------------------------------------------------------------------ */

    const CSS = [
      /* Page: the main-column contract (height 100%, own scroll, 960px column). */
      '.dsh-wa-page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;align-items:center;gap:28px;padding:28px clamp(24px,4vw,48px) 48px;overflow:auto}',
      '.dsh-wa-page>*{width:100%;max-width:960px}',
      '.dsh-wa-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}',
      '[data-platform=darwin] .dsh-wa-head{padding-top:var(--dsh-frame-top-clearance,0px)}',
      '.dsh-wa-title{margin:0;font-size:20px;font-weight:500;line-height:28px}',
      '.dsh-wa-intro{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:13px;line-height:20px}',
      '.dsh-wa-toolbar{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex:none}',
      '.dsh-wa-summary,.dsh-wa-status{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}',
      '.dsh-wa-groups{display:flex;flex-direction:column;gap:6px}',
      '.dsh-wa-group{display:flex;flex-direction:column;gap:2px}',
      '.dsh-wa-groupHead{display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px}',
      '.dsh-wa-groupHead:hover{background:var(--dsw-alias-interactive-bg-hover,transparent)}',
      '.dsh-wa-chevron{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.dsh-wa-chevron:hover{color:var(--dsw-alias-label-primary)}',
      '.dsh-wa-chevron:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-wa-chevron svg{transition:transform .16s ease}',
      '.dsh-wa-chevron[aria-expanded=true] svg{transform:rotate(90deg)}',
      '.dsh-wa-groupMain{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}',
      '.dsh-wa-groupTitleRow{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dsh-wa-groupTitle{font-size:14px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-wa-groupPath{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.dsh-wa-groupCounts{color:var(--dsw-alias-label-caption);font-size:12.5px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.dsh-wa-groupActions{display:flex;align-items:center;gap:6px;flex:none}',
      '.dsh-wa-empty{color:var(--dsw-alias-label-tertiary);margin:0 0 0 40px;font-size:12.5px;line-height:20px}',
      '.dsh-wa-sessions{display:flex;flex-direction:column;margin:0 0 4px 30px;padding:0;list-style:none;border-left:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-wa-session{display:flex;align-items:center;gap:10px;min-width:0;padding:5px 8px;border-radius:10px}',
      '.dsh-wa-session:hover{background:var(--dsw-alias-interactive-bg-hover,transparent)}',
      '.dsh-wa-session[data-archived=true] .dsh-wa-sessionTitle{color:var(--dsw-alias-label-tertiary)}',
      '.dsh-wa-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}',
      '.dsh-wa-dot[data-running=true]{background:var(--dsw-alias-state-success-primary)}',
      '.dsh-wa-sessionTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;background:transparent;border:0;padding:0;color:inherit;text-align:left;font-family:inherit}',
      'button.dsh-wa-sessionTitle{cursor:pointer}',
      'button.dsh-wa-sessionTitle:hover{text-decoration:underline;text-underline-offset:3px}',
      'button.dsh-wa-sessionTitle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}',
      '.dsh-wa-tag{flex:none;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.14));color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px}',
      '.dsh-wa-time{flex:none;color:var(--dsw-alias-label-caption);font-size:11.5px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums}',
      /* Buttons: capsule geometry and tokens copied from the host Button. */
      '.dsh-wa-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:0;border-radius:14px;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);background:transparent;cursor:pointer;white-space:nowrap}',
      '.dsh-wa-btn:disabled{cursor:not-allowed;opacity:.4}',
      '.dsh-wa-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-wa-btnGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-wa-btnGhost:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover))}',
      '.dsh-wa-btnOutline{border:.5px solid var(--dsw-alias-border-l3)}',
      '.dsh-wa-btnOutline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-wa-btnPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.dsh-wa-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      /* Session-row menu contribution: the shipped row's cell metrics. */
      '.dsh-wa-menuItem{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
      '.dsh-wa-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-wa-menuItem:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}',
      /* Overlay: mask + centred card, copied from the host Modal. */
      '.dsh-wa-layer{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-top-clearance,24px)) 24px}',
      /* Progress is a floating notice, not a modal: the run lives in the plugin
         scope precisely so the operator can keep working, so this layer must not
         swallow clicks — the card opts back in, the mask is not rendered. */
      '.dsh-wa-layerPassive{pointer-events:none;align-items:flex-end;justify-content:flex-end}',
      '.dsh-wa-layerPassive>*{pointer-events:auto}',
      '.dsh-wa-toast{width:min(320px,calc(100vw - 48px));gap:12px;padding:14px 16px}',
      '.dsh-wa-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:var(--dsw-mask-blur,blur(2px))}',
      '.dsh-wa-dialog{position:relative;z-index:1;display:flex;flex-direction:column;gap:16px;width:min(440px,100%);max-height:100%;padding:22px 24px 20px;overflow:hidden;border-radius:20px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgba(0,0,0,.24));color:var(--dsw-alias-label-primary)}',
      '.dsh-wa-dialogTitle{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.dsh-wa-dialogBody{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dsh-wa-note{margin:0;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#c98a00) 12%,transparent);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}',
      '.dsh-wa-choice{display:flex;align-items:flex-start;gap:10px;cursor:pointer}',
      '.dsh-wa-choice input{margin:2px 0 0;width:15px;height:15px;flex:none;accent-color:var(--dsw-alias-brand-primary)}',
      '.dsh-wa-choiceMain{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dsh-wa-choiceLabel{font-size:13px;line-height:20px}',
      '.dsh-wa-choiceHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}',
      '.dsh-wa-progressTrack{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));overflow:hidden}',
      '.dsh-wa-progressFill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);transition:width .16s ease}',
      '.dsh-wa-counts{margin:0;font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}',
      '.dsh-wa-failures{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;max-height:180px;overflow-y:auto}',
      '.dsh-wa-failure{display:flex;flex-direction:column;font-size:12px;line-height:18px}',
      '.dsh-wa-failureName{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dsh-wa-failureWhy{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.dsh-wa-dialogFoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
      '@media (prefers-reduced-motion:reduce){.dsh-wa-chevron svg{transition:none}.dsh-wa-progressFill{transition:none}}',
    ].join('');

    /** The plugin's one stylesheet; identical copies render harmlessly. */
    function WaStyles() {
      return h('style', null, CSS);
    }

    /* ------------------------------------------------------------------ *
     * Small shared pieces
     * ------------------------------------------------------------------ */

    /**
     * Resolve the namespace-bound translate function, falling back to the key
     * when the dictionary registration did not land.
     * @param t - the locale seat supplied by the registration.
     * @returns a translate function.
     */
    function translator(t) {
      return typeof t === 'function' ? t : (key) => key;
    }

    /**
     * Render one of the plugin's capsule controls.
     * @param props - variant, click handler, disabled flag, pressed state, label, and children.
     * @returns the button element.
     */
    function WaButton(props) {
      const variant =
        props.variant === 'primary' ? 'dsh-wa-btnPrimary' : props.variant === 'outline' ? 'dsh-wa-btnOutline' : 'dsh-wa-btnGhost';
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-wa-btn ' + variant,
          onClick: props.onClick,
          disabled: props.disabled === true,
          title: props.title,
          'aria-label': props.ariaLabel,
          'aria-pressed': props.ariaPressed,
          ref: props.buttonRef,
        },
        props.children,
      );
    }

    /** Chevron glyph for a group row. */
    function Chevron() {
      return h(
        'svg',
        {
          width: 12,
          height: 12,
          viewBox: '0 0 12 12',
          'aria-hidden': 'true',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M4.5 2.5 8 6l-3.5 3.5' }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Surface 1: the sidebar icon
     * ------------------------------------------------------------------ */

    /**
     * The sidebar's icon share: a small archive box at the requested edge.
     * @param props - the sidebar's icon share (requested edge, selected state).
     * @returns the icon element.
     */
    function WorkspaceArchiveIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          'aria-hidden': 'true',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M4 7h16v3H4z' }),
        h('path', { d: 'M5 10h14v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18z' }),
        h('path', { d: 'M10 13.5h4' }),
        h('path', { d: 'M7.5 4.5h9' }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Surface 2: the batch page
     * ------------------------------------------------------------------ */

    /**
     * One workspace row (or the ungrouped bucket) with its expandable session
     * list. Presentational: every fact and action arrives as a prop. The pin
     * control appears only for a real Workspace on a build that can reorder one.
     * @param props - locale seat, the group, its pin state, and its callbacks.
     * @returns the group element.
     */
    function WaGroupRow(props) {
      const t = props.t;
      const group = props.group;
      const byId = props.byId;
      const pinnable = props.pinSupported === true && group.key !== '';
      const title = group.title === '' ? t('group.ungrouped') : group.title;
      const path = group.path === undefined ? t('group.ungroupedHint') : group.path;
      const label = t('group.counts', {
        total: String(group.members.length),
        pending: String(group.pending.length),
        archived: String(group.archived.length),
      });
      let list = null;
      if (props.expanded) {
        list =
          group.members.length === 0
            ? h('p', { className: 'dsh-wa-empty' }, t('group.empty'))
            : h(
                'ul',
                { className: 'dsh-wa-sessions' },
                group.members.map((id) => {
                  const summary = byId[id];
                  const archived = group.archived.includes(id);
                  const blank = group.blank.includes(id);
                  const running = summary !== undefined && summary.running === true;
                  const durable = summary === undefined ? '' : summary.displayTitle;
                  const name = blank
                    ? t('row.newSession')
                    : durable === undefined || durable === ''
                      ? t('row.untitled')
                      : durable;
                  const relative = summary === undefined ? undefined : formatRelative(summary.updatedAt, props.now);
                  const timeText = relative === undefined ? '' : t('time.' + relative.unit, { count: String(relative.count) });
                  const titleNode = archived
                    ? h('span', { className: 'dsh-wa-sessionTitle', title: name }, name)
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-wa-sessionTitle',
                          title: name,
                          'aria-label': t('row.open', { name }),
                          onClick: () => props.onOpen(id),
                        },
                        name,
                      );
                  return h(
                    'li',
                    { className: 'dsh-wa-session', key: id, 'data-archived': archived ? 'true' : 'false' },
                    h('span', {
                      className: 'dsh-wa-dot',
                      'data-running': running ? 'true' : 'false',
                      title: running ? t('row.running') : undefined,
                      'aria-hidden': 'true',
                    }),
                    titleNode,
                    blank ? h('span', { className: 'dsh-wa-tag' }, t('row.blankTag')) : null,
                    archived ? h('span', { className: 'dsh-wa-tag' }, t('row.archivedTag')) : null,
                    timeText === '' ? null : h('span', { className: 'dsh-wa-time' }, timeText),
                    h(
                      WaButton,
                      {
                        variant: 'ghost',
                        onClick: () => (archived ? props.onRestoreOne(id) : props.onArchiveOne(id)),
                        ariaLabel: archived ? t('row.restoreOne', { name }) : t('row.archiveOne', { name }),
                      },
                      archived ? t('row.restore') : t('row.archive'),
                    ),
                  );
                }),
              );
      }
      return h(
        'div',
        { className: 'dsh-wa-group' },
        h(
          'div',
          { className: 'dsh-wa-groupHead' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-wa-chevron',
              'aria-expanded': props.expanded ? 'true' : 'false',
              'aria-label': t(props.expanded ? 'group.collapse' : 'group.expand', { name: title }),
              onClick: props.onToggle,
            },
            h(Chevron, null),
          ),
          h(
            'div',
            { className: 'dsh-wa-groupMain' },
            h(
              'div',
              { className: 'dsh-wa-groupTitleRow' },
              h('span', { className: 'dsh-wa-groupTitle', title }, title),
              props.pinned ? h('span', { className: 'dsh-wa-tag' }, t('group.pinnedTag')) : null,
              group.sidebarHidden ? h('span', { className: 'dsh-wa-tag' }, t('group.hiddenTag')) : null,
            ),
            h('span', { className: 'dsh-wa-groupPath', title: path }, path),
          ),
          h('span', { className: 'dsh-wa-groupCounts' }, label),
          h(
            'div',
            { className: 'dsh-wa-groupActions' },
            pinnable
              ? h(
                  WaButton,
                  {
                    variant: props.pinned ? 'outline' : 'ghost',
                    ariaPressed: props.pinned ? 'true' : 'false',
                    title: props.pinned ? t('group.unpinHint') : t('group.pinHint'),
                    onClick: props.onTogglePin,
                  },
                  props.pinned ? t('group.unpin') : t('group.pin'),
                )
              : null,
            h(
              WaButton,
              {
                variant: group.pending.length > 0 ? 'primary' : 'ghost',
                disabled: group.pending.length === 0,
                /* A disabled control still has to explain itself: without this,
                   "the button does nothing" is the operator's whole experience. */
                title: group.pending.length === 0 ? t('group.archiveAllIdle') : t('group.archiveAllHint'),
                onClick: props.onArchiveAll,
              },
              t('group.archiveAll'),
            ),
            h(
              WaButton,
              {
                variant: 'outline',
                disabled: group.archived.length === 0,
                title: group.archived.length === 0 ? t('group.restoreAllIdle') : t('group.restoreAllHint'),
                onClick: props.onRestoreAll,
              },
              t('group.restoreAll'),
            ),
          ),
        ),
        list,
      );
    }

    /**
     * The main-column page: every workspace with its counts, batch buttons, and
     * expandable session list, plus the ungrouped bucket.
     * @param props - the slot props (global hooks, locale seat, runner share).
     * @returns the page element.
     */
    function WorkspaceArchivePage(props) {
      const t = translator(props.t);
      const items = props.useWorkspaces((snapshot) => snapshot.items);
      const archivedIds = props.useWorkspaces((snapshot) => snapshot.archivedSessionIds);
      const phase = props.useWorkspaces((snapshot) => snapshot.phase);
      const byId = props.useSessions((snapshot) => snapshot.byId);
      const ids = props.useSessions((snapshot) => snapshot.ids);
      const wa = props.useWaState((snapshot) => snapshot);
      const pinnedIds = props.useWaPins((pins) => pins);
      const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
      const pinSupported = props.pinSupported === true;
      const [openKeys, setOpenKeys] = useState(() => ({}));
      const [, setClockTick] = useState(0);

      /* Relative times age while the page stays open; one minute is enough. */
      useEffect(() => {
        const handle = setInterval(() => setClockTick((value) => value + 1), CLOCK_INTERVAL_MS);
        return () => clearInterval(handle);
      }, []);

      const groups = useMemo(() => {
        const archivedSet = new Set(archivedIds);
        const out = [];
        for (const workspace of items) {
          const part = partitionWorkspace(workspace.sessionIds, byId, archivedSet);
          if (part.members.length === 0) continue;
          out.push({
            sidebarHidden: archivedWorkspaceIds([workspace], byId, archivedIds).length > 0,
            key: workspace.workspaceId,
            title: workspace.title,
            path: workspace.path,
            sessionIds: workspace.sessionIds,
            ...part,
          });
        }
        const ungroupedIds = ungroupedSessionIds(items, ids);
        if (ungroupedIds.length > 0) {
          const part = partitionWorkspace(ungroupedIds, byId, archivedSet);
          if (part.members.length > 0) {
            out.push({ key: '', title: '', path: undefined, sessionIds: ungroupedIds, ...part });
          }
        }
        return out;
      }, [items, byId, ids, archivedIds]);

      const totals = useMemo(() => {
        let sessions = 0;
        let archived = 0;
        let workspaces = 0;
        for (const group of groups) {
          sessions += group.members.length;
          archived += group.archived.length;
          if (group.key !== '') workspaces += 1;
        }
        return { sessions, archived, workspaces };
      }, [groups]);

      const allOpen = groups.length > 0 && groups.every((group) => openKeys[group.key] === true);
      const toggle = useCallback((key) => {
        setOpenKeys((current) => ({ ...current, [key]: current[key] !== true }));
      }, []);
      const setAll = useCallback((value) => {
        setOpenKeys(() => {
          const next = {};
          for (const group of groups) next[group.key] = value;
          return next;
        });
      }, [groups]);
      const scopeOf = useCallback(
        (group) => ({ key: group.key, title: group.title, path: group.path, sessionIds: group.sessionIds }),
        [],
      );
      const requestArchive = props.requestArchive;
      const requestUnarchive = props.requestUnarchive;
      const openSession = props.openSession;
      const togglePinWorkspace = props.togglePinWorkspace;
      const archiveAll = useCallback((group) => requestArchive(scopeOf(group)), [requestArchive, scopeOf]);
      const restoreAll = useCallback((group) => requestUnarchive(scopeOf(group)), [requestUnarchive, scopeOf]);
      const togglePin = useCallback((group) => togglePinWorkspace(group.key), [togglePinWorkspace]);
      const archiveOne = useCallback(
        (group, id) => requestArchive({ key: group.key, title: group.title, path: group.path, sessionIds: [id] }),
        [requestArchive],
      );
      const restoreOne = useCallback(
        (group, id) => requestUnarchive({ key: group.key, title: group.title, path: group.path, sessionIds: [id] }),
        [requestUnarchive],
      );
      const onOpen = useCallback((id) => openSession(id), [openSession]);

      const now = Date.now();
      const run = wa.run;
      return h(
        'div',
        { className: 'dsh-wa-page' },
        h(WaStyles, { key: 'css' }),
        h(
          'div',
          { className: 'dsh-wa-head', key: 'head' },
          h(
            'div',
            null,
            h('h2', { className: 'dsh-wa-title' }, t('page.title')),
            h('p', { className: 'dsh-wa-intro' }, t('page.intro')),
          ),
          h(
            'div',
            { className: 'dsh-wa-toolbar' },
            h(
              WaButton,
              { variant: 'outline', disabled: groups.length === 0, onClick: () => setAll(!allOpen) },
              allOpen ? t('page.collapseAll') : t('page.expandAll'),
            ),
          ),
        ),
        phase !== 'ready'
          ? h('p', { className: 'dsh-wa-status', key: 'status' }, t('page.loading'))
          : groups.length === 0
            ? h('p', { className: 'dsh-wa-status', key: 'status' }, t('page.empty'))
            : h(
                'p',
                { className: 'dsh-wa-summary', key: 'summary' },
                t('page.summary', {
                  workspaces: String(totals.workspaces),
                  sessions: String(totals.sessions),
                  archived: String(totals.archived),
                }),
              ),
        groups.length === 0
          ? null
          : h(
              'div',
              { className: 'dsh-wa-groups', key: 'groups' },
              groups.map((group) =>
                h(WaGroupRow, {
                  key: group.key === '' ? '__ungrouped__' : group.key,
                  t,
                  group,
                  byId,
                  now,
                  expanded: openKeys[group.key] === true,
                  pinned: pinnedSet.has(group.key),
                  pinSupported,
                  onToggle: () => toggle(group.key),
                  onTogglePin: () => togglePin(group),
                  onArchiveAll: () => archiveAll(group),
                  onRestoreAll: () => restoreAll(group),
                  onArchiveOne: (id) => archiveOne(group, id),
                  onRestoreOne: (id) => restoreOne(group, id),
                  onOpen,
                }),
              ),
            ),
        run === null
          ? null
          : h(
              'p',
              { className: 'dsh-wa-status', key: 'run' },
              t('dialog.progress', { done: String(run.done), total: String(run.total) }),
            ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Surface 3: the session row menu entry
     * ------------------------------------------------------------------ */

    /**
     * The "archive this whole workspace" row in a Session's "..." menu. It
     * renders nothing when the Session belongs to no workspace or when that
     * workspace has nothing left to archive, so the row never offers a no-op.
     * @param props - the row share, the menu's open-state hook, runner share.
     * @returns the menu row (with the plugin's stylesheet) or null.
     */
    function ArchiveWorkspaceMenuItem(props) {
      const t = translator(props.t);
      const menuState = props.useMenuOpenState();
      const setOpen = menuState[1];
      const items = props.useWorkspaces((snapshot) => snapshot.items);
      const archivedIds = props.useWorkspaces((snapshot) => snapshot.archivedSessionIds);
      const byId = props.useSessions((snapshot) => snapshot.byId);
      const sessionId = props.sessionId;
      const owner = useMemo(() => items.find((item) => item.sessionIds.includes(sessionId)), [items, sessionId]);
      const pendingCount = useMemo(() => {
        if (owner === undefined) return 0;
        return partitionWorkspace(owner.sessionIds, byId, new Set(archivedIds)).pending.length;
      }, [owner, byId, archivedIds]);
      if (owner === undefined || pendingCount === 0) return null;
      const requestArchiveForSession = props.requestArchiveForSession;
      return h(
        Fragment,
        null,
        h(WaStyles, { key: 'css' }),
        h(
          'button',
          {
            key: 'row',
            type: 'button',
            role: 'menuitem',
            className: 'dsh-wa-menuItem',
            onClick: () => {
              setOpen(false);
              requestArchiveForSession(sessionId);
            },
          },
          t('menu.archiveWorkspace', { count: String(pendingCount) }),
        ),
      );
    }

    /**
     * The "pin this whole workspace" row in a Session's "..." menu. It renders
     * nothing when the Session belongs to no workspace or when the running build
     * exposes no Workspace reorder call, so the row never appears dead.
     * @param props - the row share, the menu's open-state hook, runner share.
     * @returns the menu row (with the plugin's stylesheet) or null.
     */
    function PinWorkspaceMenuItem(props) {
      const t = translator(props.t);
      const menuState = props.useMenuOpenState();
      const setOpen = menuState[1];
      const items = props.useWorkspaces((snapshot) => snapshot.items);
      const pinnedIds = props.useWaPins((pins) => pins);
      const sessionId = props.sessionId;
      const owner = useMemo(() => items.find((item) => item.sessionIds.includes(sessionId)), [items, sessionId]);
      if (props.pinSupported !== true || owner === undefined) return null;
      const pinned = pinnedIds.includes(owner.workspaceId);
      const togglePinWorkspace = props.togglePinWorkspace;
      return h(
        Fragment,
        null,
        h(WaStyles, { key: 'css' }),
        h(
          'button',
          {
            key: 'row',
            type: 'button',
            role: 'menuitem',
            className: 'dsh-wa-menuItem',
            onClick: () => {
              setOpen(false);
              togglePinWorkspace(owner.workspaceId);
            },
          },
          t(pinned ? 'menu.unpinWorkspace' : 'menu.pinWorkspace'),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Surface 4: confirmation, progress, and result layer
     * ------------------------------------------------------------------ */

    /**
     * One overlay entry rendering whichever layer the store asks for: the
     * stop-work confirmation, the live progress, or the result report. Escape
     * maps to the layer's cancel action, and the primary control takes focus
     * when a layer opens.
     * @param props - the runner share and the locale seat.
     * @returns the layer, or null while the plugin is idle.
     */
    function WorkspaceArchiveOverlay(props) {
      const t = translator(props.t);
      const wa = props.useWaState((snapshot) => snapshot);
      const [stopRunning, setStopRunning] = useState(false);
      const primaryRef = useRef(null);
      const layer =
        wa.pending !== null
          ? 'pending'
          : wa.run !== null
            ? 'run'
            : wa.result !== null
              ? 'result'
              : wa.notice !== null
                ? 'notice'
                : 'idle';
      const active = layer !== 'idle';
      const cancelPending = props.cancelPending;
      const cancelRun = props.cancelRun;
      const dismissResult = props.dismissResult;
      const dismissNotice = props.dismissNotice;

      /* Every new confirmation starts from the safe default: do not stop work. */
      useEffect(() => {
        if (layer === 'pending') setStopRunning(false);
      }, [layer]);

      /* The layer is modal in behaviour, not in DOM: Escape resolves it. */
      useEffect(() => {
        if (!active) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (layer === 'pending') cancelPending();
          else if (layer === 'result') dismissResult();
          else if (layer === 'notice') dismissNotice();
          else cancelRun();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
      }, [active, layer, cancelPending, cancelRun, dismissResult, dismissNotice]);

      /* Focus moves into a modal layer; a background progress card must not
         steal it from whatever the operator switched to. */
      useEffect(() => {
        if (!active || layer === 'run') return;
        const node = primaryRef.current;
        if (node !== null && node !== undefined && typeof node.focus === 'function') node.focus();
      }, [active, layer]);

      if (!active) return null;

      const passive = layer === 'run';
      const onMaskClick = layer === 'pending' ? cancelPending : layer === 'notice' ? dismissNotice : dismissResult;
      const children = [h(WaStyles, { key: 'css' })];

      if (wa.pending !== null) {
        const pending = wa.pending;
        const ungrouped = pending.title === '';
        const name = ungrouped ? t('group.ungrouped') : pending.title;
        children.push(
          h(
            'div',
            {
              className: 'dsh-wa-dialog',
              key: 'dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': ungrouped ? t('dialog.ungroupedTitle') : t('dialog.archiveTitle', { name }),
            },
            h('h3', { className: 'dsh-wa-dialogTitle' }, ungrouped ? t('dialog.ungroupedTitle') : t('dialog.archiveTitle', { name })),
            pending.path === undefined ? null : h('p', { className: 'dsh-wa-dialogBody' }, pending.path),
            h('p', { className: 'dsh-wa-dialogBody' }, t('dialog.archiveBody', { count: String(pending.targets.length) })),
            pending.blankCount === 0
              ? null
              : h('p', { className: 'dsh-wa-note' }, t('dialog.blankNote', { count: String(pending.blankCount) })),
            h(
              'label',
              { className: 'dsh-wa-choice' },
              h('input', {
                type: 'checkbox',
                checked: stopRunning,
                onChange: (event) => setStopRunning(event.target.checked === true),
              }),
              h(
                'span',
                { className: 'dsh-wa-choiceMain' },
                h('span', { className: 'dsh-wa-choiceLabel' }, t('dialog.stopRunning')),
                h('span', { className: 'dsh-wa-choiceHint' }, t('dialog.stopRunningHint')),
              ),
            ),
            h(
              'div',
              { className: 'dsh-wa-dialogFoot' },
              h(WaButton, { variant: 'outline', onClick: cancelPending }, t('dialog.cancel')),
              h(
                WaButton,
                { variant: 'primary', buttonRef: primaryRef, onClick: () => props.confirmPending(stopRunning) },
                t('dialog.confirmArchive', { count: String(pending.targets.length) }),
              ),
            ),
          ),
        );
      } else if (wa.run !== null) {
        const current = wa.run;
        const ratio = current.total === 0 ? 0 : Math.round((current.done / current.total) * 100);
        children.push(
          h(
            'div',
            {
              className: 'dsh-wa-dialog dsh-wa-toast',
              key: 'dialog',
              role: 'status',
              'aria-live': 'polite',
              'aria-label': t('dialog.progressTitle'),
            },
            h('h3', { className: 'dsh-wa-dialogTitle' }, t('dialog.progressTitle')),
            h('p', { className: 'dsh-wa-dialogBody' }, t('dialog.progress', { done: String(current.done), total: String(current.total) })),
            h('div', { className: 'dsh-wa-progressTrack' }, h('div', { className: 'dsh-wa-progressFill', style: { width: ratio + '%' } })),
            h('p', { className: 'dsh-wa-choiceHint' }, t('dialog.progressHint')),
            h(
              'div',
              { className: 'dsh-wa-dialogFoot' },
              h(WaButton, { variant: 'outline', buttonRef: primaryRef, onClick: cancelRun }, t('dialog.cancelRun')),
            ),
          ),
        );
      } else if (wa.result !== null) {
        const result = wa.result;
        const summary = summarizeRun(result);
        const done = summary.archived + summary.stopped;
        const isArchive = result.kind === 'archive';
        children.push(
          h(
            'div',
            {
              className: 'dsh-wa-dialog',
              key: 'dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': t(isArchive ? 'dialog.resultArchiveTitle' : 'dialog.resultUnarchiveTitle'),
            },
            h('h3', { className: 'dsh-wa-dialogTitle' }, t(isArchive ? 'dialog.resultArchiveTitle' : 'dialog.resultUnarchiveTitle')),
            h(
              'p',
              { className: 'dsh-wa-counts' },
              t('dialog.resultCounts', {
                done: String(done),
                skipped: String(summary.skipped),
                failed: String(summary.failed),
              }),
            ),
            result.cancelled
              ? h('p', { className: 'dsh-wa-note' }, t('dialog.resultCancelled', { remaining: String(summary.remaining) }))
              : null,
            summary.failed === 0 ? null : h('p', { className: 'dsh-wa-dialogBody' }, t('dialog.failedHead')),
            summary.failed === 0
              ? null
              : h(
                  'ul',
                  { className: 'dsh-wa-failures' },
                  result.failed.map((failure) =>
                    h(
                      'li',
                      { className: 'dsh-wa-failure', key: failure.id },
                      h('span', { className: 'dsh-wa-failureName' }, failure.id),
                      h('span', { className: 'dsh-wa-failureWhy' }, failure.message),
                    ),
                  ),
                ),
            h(
              'div',
              { className: 'dsh-wa-dialogFoot' },
              summary.skipped > 0
                ? h(
                    WaButton,
                    { variant: 'outline', onClick: props.archiveSkipped },
                    t('dialog.stopAndArchive', { count: String(summary.skipped) }),
                  )
                : null,
              isArchive && done > 0
                ? h(WaButton, { variant: 'outline', onClick: props.undoResult }, t('dialog.undoArchive', { count: String(done) }))
                : null,
              h(WaButton, { variant: 'primary', buttonRef: primaryRef, onClick: dismissResult }, t('dialog.close')),
            ),
          ),
        );
      } else if (wa.notice !== null) {
        /* The one layer that must exist for the plugin to be legible: it says
           why a control did nothing, instead of doing nothing. */
        const notice = wa.notice;
        children.push(
          h(
            'div',
            {
              className: 'dsh-wa-dialog',
              key: 'dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': notice.title,
            },
            h('h3', { className: 'dsh-wa-dialogTitle' }, notice.title),
            h('p', { className: 'dsh-wa-dialogBody' }, notice.message),
            h(
              'div',
              { className: 'dsh-wa-dialogFoot' },
              h(WaButton, { variant: 'primary', buttonRef: primaryRef, onClick: dismissNotice }, t('notice.dismiss')),
            ),
          ),
        );
      }

      return h(
        'div',
        { className: 'dsh-wa-layer' + (passive ? ' dsh-wa-layerPassive' : '') },
        passive ? null : h('div', { className: 'dsh-wa-mask', onClick: onMaskClick }),
        children,
      );
    }

    /**
     * Adapt the live browser entry while retaining its child-slot ownership,
     * store, inject face, and locale. The slot API has no filter/wrapper seam;
     * a second declaration of its children is invalid. Keep this compatibility
     * adapter isolated and restore the component on plugin disposal.
     */
    function installSidebarFilter(ctx) {
      const slots = ctx.slots;
      if (typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return () => {};
      let decorated;
      let original;
      let wrapper;
      let refresh;
      let disposed = false;
      let queued = false;
      const empty = () => null;
      function restore() {
        if (decorated !== undefined && decorated.component === wrapper) decorated.component = original;
        decorated = undefined;
      }
      function reconcile() {
        queued = false;
        if (disposed) return;
        const entry = slots.entries('sidebar.workspaces').find((candidate) => candidate.component !== empty);
        if (entry === undefined || entry === decorated && entry.component === wrapper) return;
        restore();
        decorated = entry;
        original = entry.component;
        const Browser = original;
        wrapper = function WorkspaceArchiveSidebar(props) {
          const workspaces = props.useWorkspaces((snapshot) => snapshot);
          const sessions = props.useSessions((snapshot) => snapshot);
          const filtered = useMemo(() => sidebarSnapshots(workspaces, sessions), [workspaces, sessions]);
          const useWorkspaces = useCallback((select) => select(filtered.workspaces), [filtered]);
          const useSessions = useCallback((select) => select(filtered.sessions), [filtered]);
          const actions = useMemo(() => ({
            ...props.actions,
            retainAccountKeys: (keys) => props.actions.retainAccountKeys([
              ...new Set([...keys, ...workspaces.items.map((item) => item.workspaceId)]),
            ]),
          }), [props.actions, workspaces.items]);
          const searchSessions = useCallback(async (...args) => {
            const result = await props.searchSessions(...args);
            return { ...result, items: result.items.filter((item) => !filtered.hiddenSessionIds.has(item.id)) };
          }, [props.searchSessions, filtered]);
          return h(Browser, { ...props, useWorkspaces, useSessions, actions, searchSessions });
        };
        entry.component = wrapper;
        // A non-winning contribution notifies the renderer after the adaptation.
        if (refresh !== undefined) refresh();
        refresh = slots.register({ name: 'sidebar.workspaces', priority: Number.MAX_SAFE_INTEGER }, empty);
      }
      function schedule() {
        if (queued || disposed) return;
        queued = true;
        queueMicrotask(reconcile);
      }
      const unsubscribe = slots.subscribe('sidebar.workspaces', schedule);
      reconcile();
      return () => {
        disposed = true;
        unsubscribe();
        restore();
        if (refresh !== undefined) refresh();
      };
    }

    /* ------------------------------------------------------------------ *
     * Plugin apply
     * ------------------------------------------------------------------ */

    /**
     * Services this plugin cannot do its job without.
     *
     * `workspaces` and `sessions` are the source of every count, target, and
     * enabled/disabled state this plugin renders, so they are hard dependencies
     * rather than `ctx.get(...)` lookups. Cordis gates `ctx.<service>` on this
     * declaration — an undeclared read throws
     * `cannot get property "<name>" without inject`, and because the reads
     * happened inside React event handlers that throw was swallowed, leaving
     * every button apparently dead. Both keys must stay listed here.
     */
    const inject = ['slots', 'locale', 'uiWorkspace', 'workspaces', 'sessions'];

    /**
     * Register the four surfaces, each tied to this plugin's fiber so an unload
     * removes it.
     * @param ctx - the Client root context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        try {
          return ctx.locale.register(NS, { zh, en });
        } catch (error) {
          console.warn('[workspace-archive] locale registration failed:', error);
          return () => {};
        }
      }, 'workspace-archive: dictionaries');

      const runner = createRunner(ctx);
      ctx.effect(
        () => ctx.slots.inject('sidebar.workspaces', () => installSidebarFilter(ctx)),
        'workspace-archive: hide archived workspaces',
      );

      /** Panel label thunk: re-read on every projection so it follows the locale. */
      const panelLabel = () => {
        try {
          return ctx.locale.bind(NS)('panel');
        } catch (error) {
          return 'Workspace archive';
        }
      };

      /** Opening a Session is the one navigation the page performs. */
      const openSession = (sessionId) => {
        try {
          ctx.uiWorkspace.openSession(sessionId);
        } catch (error) {
          console.warn('[workspace-archive] open session failed:', error);
        }
      };

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: panelLabel, locale: NS },
              WorkspaceArchiveIcon,
            ),
          ),
        'workspace-archive: sidebar entry',
      );

      ctx.effect(
        () =>
          ctx.slots.inject('main', () =>
            ctx.slots.register(
              {
                name: 'main',
                key: PANEL_ID,
                locale: NS,
                inject: () => ({ ...runner.face(), openSession }),
              },
              WorkspaceArchivePage,
            ),
          ),
        'workspace-archive: panel',
      );

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
            ctx.slots.register(
              {
                name: 'sidebar.workspaces.session.menu.item',
                id: MENU_ID,
                order: MENU_ORDER,
                locale: NS,
                inject: () => runner.face(),
              },
              ArchiveWorkspaceMenuItem,
            ),
          ),
        'workspace-archive: row menu',
      );

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
            ctx.slots.register(
              {
                name: 'sidebar.workspaces.session.menu.item',
                id: PIN_MENU_ID,
                order: PIN_MENU_ORDER,
                locale: NS,
                inject: () => runner.face(),
              },
              PinWorkspaceMenuItem,
            ),
          ),
        'workspace-archive: row menu pin',
      );

      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: OVERLAY_ID, order: OVERLAY_ORDER, locale: NS, inject: () => runner.face() },
              WorkspaceArchiveOverlay,
            ),
          ),
        'workspace-archive: overlay',
      );
    }

    return {
      inject,
      apply,
      /* Test seam: test/plan.test.mjs asserts these over this very artifact, so
         the unit tests cannot drift from what ships. */
      internals: {
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
        archivedWorkspaceIds,
        sidebarSnapshots,
        installSidebarFilter,
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
      },
    };
  },
});
