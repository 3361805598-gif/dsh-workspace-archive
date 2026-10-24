# Workspace Archive

`@local/dsh-workspace-archive` 0.2.1, a plain-JavaScript DSH Web / Desktop plugin with no build step.

Archive or restore a workspace's conversations in one action. **Once all real conversations are archived, the entire workspace disappears from the sidebar, including its blank New Session entry.** It remains available in the Workspace Archive management panel. Restoring any real conversation shows it again. Workspace pinning is also supported.

## Usage

Open the archive icon in the sidebar. The panel shows each workspace's path, session counts, Archive all, Restore all, pin controls, and an expandable conversation list. A hidden workspace carries a Hidden from sidebar tag. Session row menus also offer workspace archive and pin actions.

Archive requests ask for confirmation. Running sessions are skipped by default; work stops only when the operator explicitly selects Also stop running sessions or the corresponding retry action. A floating progress card permits panel navigation and cancellation of remaining work. Results report failures and offer an undo action.

## Visibility and restoration

- A workspace with real conversation history is hidden when all that history is archived. Blank placeholders and subagents do not prevent hiding.
- Unarchived conversations, including skipped running sessions, failed archive calls, or unfinished cancelled batches, keep the workspace visible.
- Empty and blank-only workspaces remain available for starting work.
- Visibility derives from the Host's durable archive set, so it survives reloads and applies to workspaces archived by older plugin versions without another archive action.
- Hidden sessions do not reappear under Ungrouped, flat browsing, or sidebar search. Sidebar archive filters do not show the hidden workspace; use this plugin's panel to restore it.
- Restore any real conversation to show the workspace again, or Restore all to restore its group. Individually archived blanks remain restorable too.
- Workspace registrations, logs, directories, membership, and saved workspace expansion/manual order are retained. Hiding a parent does not archive separately registered child workspaces.

## Pinning

Pins use the Host's `workspaces.insertBefore` reorder and keep the pinned block ahead of new workspaces and manual moves. The most recent pin leads; unpinning places a workspace below the remaining pinned block. Order is Host-durable, while pin membership is browser-local under `dsh.workspace-archive.pinned-workspaces`. Controls are hidden when the reorder API is unavailable.

## Installation and updates

Install this directory through the DSH plugin manager. The manifest's `dsh.bundle.patch` points to `cordis.patch.yml`, inserting the `workspace-archive` row. The Host entry has no business behavior; archive operations still use `uiWorkspace.archiveSession/unarchiveSession`.

Use the manager's `application` and `nextStep` results to determine whether an update is live. Source edits alone do not imply an existing browser has reloaded the code. Refresh the current DSH page after updating; restart Desktop first when the manager requires it.

## Compatibility and rollback

The 0.2.1 sidebar contract was checked against DSH 0.2.1-rc.3. That version exposes neither a workspace visibility filter nor an official occupant-wrapper API. The isolated `installSidebarFilter` compatibility adapter wraps the live `sidebar.workspaces` entry's component and filters only its workspace/session props. The entry's existing children, store, inject face, locale, and actions remain in place. It does not redeclare children, import Harness Client packages, or read/write other plugins' DOM.

This depends on the mutable entry representation, **not a Host-guaranteed stable filter extension point**; Host upgrades need regression verification. The adapter follows the declaration lifetime through `slots.inject`, observes entry replacement, and restores the original component when unloaded. The management panel keeps the full snapshots. Disabling the plugin removes workspace hiding but leaves session archive records intact.

## Checks

```sh
node scripts/check.mjs
node --test 'test/**/*.test.mjs'
```

Coverage includes archive button wiring, running-work refusal, pins, completed workspace hiding, blank placeholders, partial archives, missing summaries, loading baselines, Ungrouped/search leakage, restoration, saved account keys, entry replacement, and unload restoration. See `VERIFICATION.md` for installation and browser validation limits; stubbed component tests do not establish the actual rendered result.
