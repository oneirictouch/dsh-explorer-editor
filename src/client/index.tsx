/**
 * Client half of the dsh-explorer-editor plugin.
 *
 * Responsibilities:
 *  1. Mount the `fileManager` Typert Remote contribution so
 *     `ctx.remote.fileManager.*` becomes callable.
 *  2. Register the "工作区 / 文件" view-tab strip into the
 *     `sidebar.workspaces.tabs` slot. The workspace browser bundle is patched
 *     to render that slot inside its section header (in place of the
 *     "工作区" label), so the strip sits in the same row as search and the
 *     view actions. On DSH builds without the patch the slot never exists and
 *     the legacy footer toggle registers instead (see tabsSlotLive.ts).
 *  3. Swap the `sidebar.workspaces` cell content: while the "文件" tab is
 *     selected we register a shadow entry at priority -1 (the workspace
 *     browser's own entry sits at default priority 0, so ours wins the cell);
 *     switching back to "工作区" disposes the entry and the workspace browser
 *     returns. The file-manager panel wrapper renders the same tab strip on
 *     top, so the strip stays visible in both views.
 *  4. Register the file EDITOR as a `conversation.view` tab ("文件"). The
 *     sidebar tree only browses; clicking a file loads it into the shared
 *     store and the editor renders IN the conversation center column's scroll
 *     body (beside chat / trajectory), never as a popup.
 *
 * The client bundle is built to the ModuleLoader handoff format
 * (`window.__ModuleLoader__.load({ id, factory })`) by build.mjs; this module
 * is the bundle's entry, exporting the cordis plugin surface.
 */
import type { Context } from '@deepseek-ai/cordis';
import { TYPERT_REMOTE, type FileManagerRemote } from './remote.ts';
import { unwrap } from './remote.ts';
import { FileManagerPanel, type FileManagerSessionHook } from './FileManagerPanel.tsx';
import { FileEditorView } from './FileEditorView.tsx';
import { SidebarTabs, FolderOpenIcon } from './SidebarTabs.tsx';
import { setSidebarTab } from './sidebarTabsStore.ts';
import { installTabsSlotWatch, useTabsSlotLive } from './tabsSlotLive.ts';
import { isEditorViewActive, subscribeEditorViewActive, restoreTabs, setWorkspaceRoot, type OpenTab } from './store.ts';
import { loadSnapshot, clearSnapshot, filterByRoot, type PersistTab } from './editorPersist.ts';
import { NS, zh, en, type Translator } from './i18n.ts';
import styles from './styles.css';

// Inject the plugin stylesheet once (the bundle's css is text via esbuild).
const CSS_TAG = 'dsh-explorer-editor/styles.css';
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) === null) {
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-explorer-editor';
  tag.dataset.pluginCss = CSS_TAG;
  tag.textContent = styles;
  document.head.appendChild(tag);
}

/** Dictionary namespace owned by this plugin (dictionaries live in i18n.ts). */

/** Required client services. */
export const inject = ['slots', 'locale', 'remote'];

/**
 * Restore the editor session persisted before the page reload: re-open the
 * same tabs (with unsaved edits for small files; large files re-read from
 * disk) and re-select the active tab. Skips silently when the snapshot's
 * workspace root no longer matches the current one.
 */
async function restoreEditorSession(ctx: Context): Promise<void> {
  try {
    const remote = ctx.get('remote.fileManager') as unknown as FileManagerRemote | undefined;
    if (remote === undefined) return;
    const { path: root } = unwrap(await remote.getRoot());
    const snapshot = loadSnapshot();
    if (snapshot === null) return;
    if (snapshot.root !== root) {
      // Different workspace: the old tabs do not belong here.
      clearSnapshot();
      return;
    }
    setWorkspaceRoot(root);
    const kept = filterByRoot(snapshot.tabs, root) as PersistTab[];
    if (kept.length === 0) return;
    const restored: OpenTab[] = [];
    for (const tab of kept) {
      if (tab.content !== undefined) {
        restored.push({
          path: tab.path,
          content: tab.content,
          savedContent: tab.savedContent ?? tab.content,
          mtimeMs: tab.mtimeMs,
          dirty: tab.dirty,
          error: tab.error,
        });
      } else {
        // Content was too large to persist: re-read from disk.
        try {
          const value = unwrap(await remote.readText(tab.path));
          restored.push({
            path: value.path,
            content: value.content,
            savedContent: value.content,
            mtimeMs: value.mtimeMs,
            dirty: false,
            error: undefined,
          });
        } catch (error) {
          restored.push({
            path: tab.path,
            content: '',
            savedContent: '',
            mtimeMs: tab.mtimeMs,
            dirty: tab.dirty,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (restored.length > 0) {
      const active = snapshot.activePath !== null && restored.some((t) => t.path === snapshot.activePath)
        ? snapshot.activePath
        : (restored[restored.length - 1]?.path ?? null);
      restoreTabs(restored, active);
      ctx.logger?.info?.(`[dsh-explorer-editor] restored ${restored.length} editor tab(s) from session`);
    }
  } catch {
    // Restore is best-effort; failures leave the default empty state.
  }
}

/**
 * Client plugin body: mount the remote, register the sidebar view-tab strip
 * (with the footer-toggle fallback), the cell shadow swap, and the
 * center-column editor view.
 */
export function apply(ctx: Context) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-explorer-editor: dictionaries');
  const t = ctx.locale.bind(NS);

  // Watch the tabs slot so the footer fallback hides once the strip is live.
  ctx.effect(() => installTabsSlotWatch(ctx), 'dsh-explorer-editor: tabs slot watch');

  // Mount the remote contribution (async; $mount installs namespace services).
  const mountRemote = ctx.effect(async () => {
    const dispose = await ctx.remote.$mount(TYPERT_REMOTE);
    void restoreEditorSession(ctx); // fire-and-forget: reload session tabs
    return () => dispose();
  }, 'dsh-explorer-editor: remote mount');

  // ── panel toggle state ───────────────────────────────────────────────────
  // While the "文件" tab is selected, `disposePanel` holds the disposer of our
  // sidebar.workspaces shadow entry; switching back runs it and the workspace
  // browser resurfaces. The selected tab mirrors this in sidebarTabsStore so
  // the strip highlights consistently in both render sites.
  let disposePanel: (() => void) | null = null;
  let open = false;

  const closePanel = () => {
    if (disposePanel === null) return;
    disposePanel();
    disposePanel = null;
    open = false;
    setSidebarTab('workspace');
    ctx.logger?.info?.('[dsh-explorer-editor] file manager closed');
  };

  const openPanel = () => {
    if (disposePanel !== null) return;
    // Resolve the mounted namespace service through ctx.get (a bare property
    // read would require the `remote.fileManager` inject, which cannot be
    // declared because we mount the contribution inside our own apply).
    const remote = ctx.get('remote.fileManager') as unknown as FileManagerRemote;
    // Register a shadow entry at priority -1: the sidebar.workspaces cell is
    // single, and the workspace browser registered at default priority 0, so
    // the lowest live entry (ours) renders while we stay registered. The
    // panel receives the slot's standard kit (useSessions / useWorkspaces)
    // so it can resolve the current conversation's workspace directory. The
    // wrapper renders the same tab strip on top so the view switcher stays
    // visible while the file manager owns the cell.
    disposePanel = ctx.slots.register({
      name: 'sidebar.workspaces',
      priority: -1,
      registrant: 'dsh-explorer-editor',
    }, (props: { wide?: boolean; expandSidebar?: () => void; useSessions?: FileManagerSessionHook }) => (
      <div className="dshf-panel-wrap">
        <SidebarTabs wide={props.wide} expandSidebar={props.expandSidebar} t={t} onSelectFile={openPanel} onSelectWorkspace={closePanel} />
        <FileManagerPanel remote={remote} t={t} useSessions={props.useSessions} onFileOpened={activateEditorView} />
      </div>
    ));
    open = true;
    setSidebarTab('files');
    ctx.logger?.info?.('[dsh-explorer-editor] file manager opened');
  };

  const togglePanel = () => (open ? closePanel() : openPanel());

  // ── sidebar visibility sync with the center "文件" view ───────────────────
  // When the "文件" conversation view becomes active, open the sidebar tree
  // panel automatically; when the view is switched away (e.g. "对话"), close
  // it again. openPanel/closePanel are idempotent, so this is safe to run on
  // every activation change. Manual tab clicks still win while the view stays
  // active.
  const syncSidebarWithView = () => {
    if (isEditorViewActive()) openPanel();
    else closePanel();
  };
  ctx.effect(() => subscribeEditorViewActive(syncSidebarWithView), 'dsh-explorer-editor: view↔sidebar sync');

  // ── center-column editor view (conversation.view) ────────────────────────
  // A view tab beside chat / trajectory. The session header renders the tab;
  // the view area (inside the conversation scroll body) renders our editor
  // when active. Renders a hint until a file is opened from the sidebar tree.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'dsh-explorer-editor',
    order: 20,
    label: () => t('view.label'),
    locale: NS,
    registrant: 'dsh-explorer-editor',
  }, () => {
    const remote = ctx.get('remote.fileManager') as unknown as FileManagerRemote | undefined;
    if (remote === undefined) return null;
    return <FileEditorView remote={remote} t={t} />;
  }));

  // ── sidebar view-tab strip (sidebar.workspaces.tabs) ─────────────────────
  // Rendered by the workspace browser's section header (patched bundle). The
  // entry never materializes when the slot is undeclared (unpatched DSH), in
  // which case the footer fallback below stays visible.
  ctx.slots.inject('sidebar.workspaces.tabs', () => ctx.slots.register({
    name: 'sidebar.workspaces.tabs',
    id: 'dsh-explorer-editor-tabs',
    priority: 0,
    locale: NS,
    registrant: 'dsh-explorer-editor',
  }, (props: { wide?: boolean; expandSidebar?: () => void }) => (
    <SidebarTabs wide={props.wide} expandSidebar={props.expandSidebar} t={t} onSelectFile={openPanel} onSelectWorkspace={closePanel} />
  )));

  // ── footer fallback toggle ───────────────────────────────────────────────
  // Kept only for DSH builds without the tabs-slot patch: hides itself the
  // moment the strip has a live entry (see tabsSlotLive.ts).
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-explorer-editor-toggle',
    locale: NS,
    inject: () => ({
      onToggle: togglePanel,
      isOpen: () => open,
      t,
    }),
  }, FileToggleButton));

  /**
   * Bring the center-column "文件" view to the front after a file opens.
   * The conversation view tabs are owned by dsh-client-ui-conversation's
   * internal chat store with no public setView API, so we click the matching
   * session-header tab (role="tab") by its localized label — the same
   * gesture the user would make. The sidebar tab strip is deliberately NOT
   * role="tab", and the `.dshf-tabs` guard below keeps this robust even if a
   * future layout ever reuses the role.
   */
  const activateEditorView = () => {
    const label = t('view.label');
    for (const tab of Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))) {
      if (tab.closest('.dshf-tabs') !== null) continue;
      if (tab.textContent?.trim() === label) {
        tab.click();
        return;
      }
    }
  };

  // On unload, close the panel (restores the workspace browser).
  ctx.effect(() => () => {
    closePanel();
  }, 'dsh-explorer-editor: panel cleanup');

  // Keep the mount effect referenced so it isn't tree-shaken.
  void mountRemote;
}

/**
 * The legacy footer action button (fallback only). Renders nothing while the
 * sidebar view-tab strip is live, so the two entry points never double up.
 */
function FileToggleButton(props: {
  wide?: boolean;
  t: Translator;
  onToggle: () => void;
  isOpen: () => boolean;
}): JSX.Element | null {
  const { wide, t, onToggle, isOpen } = props;
  const tabsLive = useTabsSlotLive();
  if (tabsLive) return null;
  const label = t('toggle.label');
  const title = isOpen() ? t('toggle.close') : t('toggle.open');
  return (
    <button
      type="button"
      className="dshf-toggle"
      title={title}
      aria-label={label}
      onClick={onToggle}
      style={isOpen() ? { fontWeight: 700 } : undefined}
    >
      <FolderOpenIcon size={wide ? 14 : 16} />
      {wide ? <span className="dshf-toggle-label">{label}</span> : null}
    </button>
  );
}
