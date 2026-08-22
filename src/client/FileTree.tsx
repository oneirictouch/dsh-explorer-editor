/**
 * Lazy file tree: lists the workspace root, expands directories on demand,
 * and opens files on click. Keyboard-navigable following the VS Code explorer
 * model: ↑/↓ move the selection, Enter/Space open or toggle, → expands a
 * collapsed directory, ← collapses an expanded one.
 *
 * Creation and rename follow the VS Code interaction: an inline input row
 * inside the tree (Enter to confirm, Esc / blur to cancel) instead of
 * window.prompt, so the flow works identically on web and desktop. Delete
 * stays in the panel (destructive confirm + editor-tab cleanup).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { FileManagerRemote, FileEntry } from './remote.ts';
import { unwrap } from './remote.ts';
import { TreeContextMenu, type TreeMenuItem } from './TreeContextMenu.tsx';
import { useClipboard, setClipboard, clearClipboard } from './clipboard.ts';
import { relativePath, baseName } from './paths.ts';
import { cx } from './cx.ts';
import { format, type Translator } from './i18n.ts';

/** A directory node that has been expanded at least once. */
interface DirNode {
  path: string;
  entries: FileEntry[] | null; // null while loading
  error?: string;
}

/** Inline-editing state: a create draft row, or a rename of an existing node. */
type Editing =
  | { mode: 'create'; parent: string; kind: 'file' | 'directory' }
  | { mode: 'rename'; path: string };

export interface TreeRef {
  /** Refresh the root listing. */
  refresh(): void;
  /**
   * VS Code-style inline creation: expand an input row inside the target
   * directory (selected dir, selected file's parent, else root).
   */
  beginCreate(kind: 'file' | 'directory'): void;
}

interface FileTreeProps {
  remote: FileManagerRemote;
  root: string;
  /** Bound translator for UI strings. */
  t: Translator;
  onOpenFile: (path: string) => void;
  onDelete: (path: string) => void;
  /** Fired after a successful inline rename so the panel can retitle tabs. */
  onRenamed: (from: string, to: string) => void;
  /** Status-line messages (creation/rename results, validation errors). */
  onNotice: (message: string) => void;
}

export const FileTree = forwardRef<TreeRef, FileTreeProps>(function FileTree(
  { remote, root, t, onOpenFile, onDelete, onRenamed, onNotice },
  ref,
) {
  const [expanded, setExpanded] = useState<Record<string, DirNode>>({ [root]: { path: root, entries: null } });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [rev, setRev] = useState(0); // bump to reload the root
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null);
  const clipboard = useClipboard();
  /** Paths known to be directories (rebuilt every render). */
  const dirPaths = useRef<Set<string>>(new Set());
  /** Visible node paths in render order (keyboard-navigation index). */
  const visibleNodes = useRef<string[]>([]);
  /** Live DOM nodes keyed by path (for focus / scroll-into-view). */
  const nodeEls = useRef<Map<string, HTMLDivElement>>(new Map());

  // Refs mirroring the latest state for the SSE handler (avoid re-subscribing).
  const rootRef = useRef(root);
  rootRef.current = root;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const menuRef = useRef(menu);
  menuRef.current = menu;

  /** Parent directory of a workspace path (falls back to root). */
  const parentOf = useCallback(
    (p: string): string => {
      const i = p.lastIndexOf('/');
      if (i <= 0) return root;
      return p.slice(0, i) || root;
    },
    [root],
  );

  /** Load (or reload) one directory level. */
  const loadDir = useCallback(
    async (path: string) => {
      setExpanded((prev) => ({ ...prev, [path]: { ...(prev[path] ?? { path }), entries: null, error: undefined } }));
      try {
        const value = unwrap(await remote.listDir(path));
        setExpanded((prev) => ({ ...prev, [path]: { path, entries: value.entries } }));
      } catch (error) {
        setExpanded((prev) => ({ ...prev, [path]: { path, entries: [], error: error instanceof Error ? error.message : String(error) } }));
      }
    },
    [remote],
  );

  // Initial load of the root; root switch drops any pending edit.
  useEffect(() => {
    setEditing(null);
    setMenu(null);
    void loadDir(root);
  }, [root, rev, loadDir]);

  // Live refresh: the host watches the workspace and pushes change events over
  // SSE. We reload only the affected directories (or everything on root change).
  useEffect(() => {
    const es = new EventSource('/dsh-explorer-editor/watch');
    es.onmessage = (event: MessageEvent) => {
      if (editingRef.current !== null || menuRef.current !== null) return; // don't disrupt in-progress edits
      try {
        const msg = JSON.parse(event.data as string) as { dirs?: string[]; rootChanged?: boolean };
        if (msg.rootChanged) {
          void loadDir(rootRef.current);
          for (const dir of Object.keys(expandedRef.current)) void loadDir(dir);
          return;
        }
        if (Array.isArray(msg.dirs)) {
          for (const dir of msg.dirs) {
            if (dir === rootRef.current || expandedRef.current[dir] !== undefined) void loadDir(dir);
          }
        }
      } catch { /* ignore malformed event */ }
    };
    return () => es.close();
  }, [loadDir]);

  // Backstop: refresh everything when the window regains focus / becomes visible,
  // covering any events missed while the SSE connection was down.
  useEffect(() => {
    const fullRefresh = () => {
      void loadDir(rootRef.current);
      for (const dir of Object.keys(expandedRef.current)) void loadDir(dir);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fullRefresh();
    };
    window.addEventListener('focus', fullRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', fullRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadDir]);

  // ── context menu: actions ────────────────────────────────────────────────

  const closeMenu = useCallback(() => setMenu(null), []);

  /** Copy text to the OS clipboard (127.0.0.1 counts as a secure context). */
  const copyToClipboard = useCallback(async (text: string, okMessage: string) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error(t('tree.clipboardUnavailable'));
      await navigator.clipboard.writeText(text);
      onNotice(okMessage);
    } catch (error) {
      onNotice(format(t('tree.copyFailed'), { message: error instanceof Error ? error.message : String(error) }));
    }
  }, [onNotice, t]);

  /** Paste the pending cut/copy into a target directory. */
  const pasteInto = useCallback(
    async (targetDir: string, sourcePath: string) => {
      const kind = clipboard?.kind ?? 'copy';
      const name = baseName(sourcePath);
      const dest = `${targetDir.replace(/\/$/, '')}/${name}`;
      const sourceParent = parentOf(sourcePath);
      const verb = kind === 'cut' ? t('tree.move') : t('tree.copyVerb');
      if (dest === sourcePath) {
        onNotice(t('tree.alreadyThere'));
        return;
      }
      try {
        if (kind === 'cut') {
          await unwrap(await remote.rename(sourcePath, dest));
          onRenamed(sourcePath, dest);
        } else {
          await unwrap(await remote.copy(sourcePath, dest));
        }
        await loadDir(targetDir);
        if (sourceParent !== targetDir) await loadDir(sourceParent);
        setSelected(dest);
        clearClipboard();
        onNotice(format(kind === 'cut' ? t('tree.moved') : t('tree.copiedVerb'), { name }));
      } catch (error) {
        onNotice(format(t('tree.pasteFailed'), { verb, message: error instanceof Error ? error.message : String(error) }));
      }
    },
    [clipboard, remote, parentOf, loadDir, onRenamed, onNotice, t],
  );

  /** Build the context-menu items for the open menu target. */
  const menuItems = useMemo<TreeMenuItem[]>(() => {
    if (menu === null) return [];
    const { path, isDir } = menu;
    const name = baseName(path);
    const items: TreeMenuItem[] = [
      {
        id: 'cut',
        label: t('menu.cut'),
        onSelect: () => {
          setClipboard({ kind: 'cut', path });
          onNotice(format(t('tree.cut'), { name }));
        },
      },
      {
        id: 'copy',
        label: t('menu.copy'),
        onSelect: () => {
          setClipboard({ kind: 'copy', path });
          onNotice(format(t('tree.copied'), { name }));
        },
      },
      {
        id: 'rename',
        label: t('menu.rename'),
        onSelect: () => {
          setSelected(path);
          setEditing({ mode: 'rename', path });
        },
      },
      {
        id: 'copy-path',
        label: t('menu.copyPath'),
        onSelect: () => void copyToClipboard(path, t('tree.copiedPath')),
      },
      {
        id: 'copy-rel-path',
        label: t('menu.copyRelativePath'),
        onSelect: () => void copyToClipboard(relativePath(root, path), t('tree.copiedRelativePath')),
      },
      {
        id: 'delete',
        label: t('menu.delete'),
        onSelect: () => onDelete(path),
      },
    ];
    if (isDir) {
      items.push({ id: 'paste-sep', separator: true, label: '', onSelect: () => {} });
      items.push({
        id: 'paste',
        label: clipboard === null
          ? t('menu.paste')
          : format(clipboard.kind === 'cut' ? t('menu.pasteMove') : t('menu.pasteCopy'), { name: baseName(clipboard.path) }),
        disabled: clipboard === null,
        onSelect: () => {
          if (clipboard !== null) void pasteInto(path, clipboard.path);
        },
      });
    }
    return items;
  }, [menu, clipboard, root, t, onNotice, copyToClipboard, pasteInto, onDelete]);

  /**
   * Target directory for "new file/dir": the selected directory (expanded or
   * not — VS Code creates inside a collapsed selection too), the selected
   * file's parent, else the root.
   */
  const cwdTarget = useCallback((): string => {
    if (selected === null) return root;
    if (dirPaths.current.has(selected)) return selected;
    return parentOf(selected);
  }, [selected, root, parentOf]);

  const beginCreate = useCallback(
    (kind: 'file' | 'directory') => {
      const parent = cwdTarget();
      // Expand the target so the draft row is visible (root is always open).
      if (parent !== root && expanded[parent] === undefined) void loadDir(parent);
      setSelected(parent);
      setEditing({ mode: 'create', parent, kind });
    },
    [cwdTarget, expanded, loadDir, root],
  );

  useImperativeHandle(ref, () => ({
    refresh: () => setRev((v) => v + 1),
    beginCreate,
  }), [beginCreate]);

  const cancelEdit = useCallback(() => setEditing(null), []);

  /** Confirm an inline create. Returns false to keep the input open. */
  const submitCreate = useCallback(
    async (name: string): Promise<boolean> => {
      if (editing?.mode !== 'create') return true;
      const trimmed = name.trim();
      if (trimmed === '') return true; // empty = cancel silently (like VS Code)
      if (trimmed.includes('/')) {
        onNotice(t('tree.noSlash'));
        return false;
      }
      const target = `${editing.parent.replace(/\/$/, '')}/${trimmed}`;
      try {
        if (editing.kind === 'directory') await unwrap(await remote.createDirectory(target));
        else await unwrap(await remote.createFile(target));
      } catch (error) {
        onNotice(format(t('tree.createFailed'), { message: error instanceof Error ? error.message : String(error) }));
        return false; // keep the input open so the name can be fixed
      }
      await loadDir(editing.parent);
      setEditing(null);
      setSelected(target);
      onNotice(format(editing.kind === 'directory' ? t('tree.createdDirectory') : t('tree.createdFile'), { name: trimmed }));
      if (editing.kind === 'file') onOpenFile(target);
      return true;
    },
    [editing, remote, loadDir, onNotice, onOpenFile, t],
  );

  /** Confirm an inline rename. Returns false to keep the input open. */
  const submitRename = useCallback(
    async (name: string): Promise<boolean> => {
      if (editing?.mode !== 'rename') return true;
      const from = editing.path;
      const trimmed = name.trim();
      const oldName = from.split('/').pop() ?? '';
      if (trimmed === '' || trimmed === oldName) return true; // unchanged = cancel
      if (trimmed.includes('/')) {
        onNotice(t('tree.noSlash'));
        return false;
      }
      const to = `${parentOf(from).replace(/\/$/, '')}/${trimmed}`;
      try {
        await unwrap(await remote.rename(from, to));
      } catch (error) {
        onNotice(format(t('tree.renameFailed'), { message: error instanceof Error ? error.message : String(error) }));
        return false;
      }
      await loadDir(parentOf(from));
      setEditing(null);
      setSelected(to);
      onRenamed(from, to);
      onNotice(format(t('tree.renamed'), { name: trimmed }));
      return true;
    },
    [editing, remote, loadDir, parentOf, onRenamed, onNotice, t],
  );

  /** Activate a node (select + open file / toggle directory), shared by click and keyboard. */
  const activate = useCallback((path: string, isDir: boolean) => {
    setSelected(path);
    if (isDir) {
      if (expanded[path] !== undefined) {
        setExpanded((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
      } else {
        void loadDir(path);
      }
    } else {
      onOpenFile(path);
    }
  }, [expanded, loadDir, onOpenFile]);

  /** Keyboard navigation for the tree (arrows + Enter/Space). */
  const handleTreeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing !== null || menu !== null) return;
    const nodes = visibleNodes.current;
    if (nodes.length === 0) return;
    const index = selected === null ? -1 : nodes.indexOf(selected);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (index < nodes.length - 1) {
          const next = nodes[index + 1];
          setSelected(next);
          nodeEls.current.get(next)?.focus();
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (index > 0) {
          const prev = nodes[index - 1];
          setSelected(prev);
          nodeEls.current.get(prev)?.focus();
        } else if (index === -1 && nodes.length > 0) {
          setSelected(nodes[0]);
          nodeEls.current.get(nodes[0])?.focus();
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (selected !== null) activate(selected, dirPaths.current.has(selected));
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (selected !== null && dirPaths.current.has(selected) && expanded[selected] === undefined) void loadDir(selected);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (selected !== null && dirPaths.current.has(selected) && expanded[selected] !== undefined) {
          setExpanded((prev) => {
            const next = { ...prev };
            delete next[selected];
            return next;
          });
        }
        break;
      default:
        break;
    }
  }, [editing, menu, selected, expanded, activate, loadDir]);

  /** Recursively render one level (inline; the tree is shallow by default). */
  const renderLevel = useCallback(
    (path: string, entries: FileEntry[], depth: number): React.ReactNode => {
      const draftHere = editing?.mode === 'create' && editing.parent === path ? editing : null;
      return (
        <>
          {draftHere !== null && (
            <InlineInput
              depth={depth}
              isDir={draftHere.kind === 'directory'}
              initial=""
              t={t}
              onSubmit={submitCreate}
              onCancel={cancelEdit}
            />
          )}
          {entries.map((entry) => {
            const full = `${path.replace(/\/$/, '')}/${entry.name}`;
            const isDir = entry.type === 'directory';
            if (isDir) dirPaths.current.add(full);
            visibleNodes.current.push(full);
            const isOpen = expanded[full] !== undefined;
            const isRenaming = editing?.mode === 'rename' && editing.path === full;
            return (
              <div key={full}>
                {isRenaming ? (
                  <InlineInput
                    depth={depth}
                    isDir={isDir}
                    initial={entry.name}
                    t={t}
                    onSubmit={submitRename}
                    onCancel={cancelEdit}
                  />
                ) : (
                  <div
                    role="treeitem"
                    aria-selected={selected === full}
                    aria-expanded={isDir ? (isOpen ? true : false) : undefined}
                    tabIndex={selected === full ? 0 : -1}
                    ref={(el) => {
                      if (el !== null) nodeEls.current.set(full, el);
                      else nodeEls.current.delete(full);
                    }}
                    className={cx(
                      'dshf-node',
                      selected === full && 'dshf-selected',
                      clipboard !== null && clipboard.kind === 'cut' && clipboard.path === full && 'dshf-cut',
                    )}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                    onClick={() => activate(full, isDir)}
                    onDoubleClick={() => {
                      if (!isDir && selected === full) onOpenFile(full);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelected(full);
                      setMenu({ x: e.clientX, y: e.clientY, path: full, isDir });
                    }}
                    title={full}
                  >
                    <span className="dshf-caret">{isDir ? (isOpen ? '▾' : '▸') : ''}</span>
                    <span className={cx('dshf-icon', isDir ? 'dshf-icon-dir' : 'dshf-icon-file')}>{isDir ? '📁' : '📄'}</span>
                    <span className="dshf-name">{entry.name}</span>
                    <span className="dshf-node-actions">
                      <button type="button" className="dshf-mini" title={t('tree.renameTitle')} onClick={(e) => { e.stopPropagation(); setSelected(full); setEditing({ mode: 'rename', path: full }); }}>✎</button>
                      <button type="button" className="dshf-mini" title={t('tree.deleteTitle')} onClick={(e) => { e.stopPropagation(); onDelete(full); }}>🗑</button>
                    </span>
                  </div>
                )}
                {isDir && isOpen && (
                  <DirChildren
                    node={expanded[full]}
                    depth={depth + 1}
                    t={t}
                    onRender={renderLevel}
                  />
                )}
              </div>
            );
          })}
        </>
      );
    },
    [expanded, selected, editing, loadDir, onOpenFile, onDelete, submitCreate, submitRename, cancelEdit, activate, t],
  );

  const node = expanded[root];

  // Rebuild per-render indexes so keyboard navigation and create-target
  // detection never see stale entries from renamed/deleted nodes.
  visibleNodes.current = [];
  dirPaths.current.clear();

  return (
    <div
      className="dshf-tree-scroll"
      role="tree"
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
      onContextMenu={(e) => {
        // Blank tree area: treat as the workspace root (paste target).
        e.preventDefault();
        setSelected(root);
        setMenu({ x: e.clientX, y: e.clientY, path: root, isDir: true });
      }}
    >
      {node === undefined ? null : node.entries === null ? (
        <div className="dshf-tree-hint">{node.error ? format(t('tree.loadFailed'), { message: node.error }) : t('tree.loading')}</div>
      ) : (
        <div className="dshf-tree-list">
          {node.entries.length === 0 && editing?.mode !== 'create' && <div className="dshf-tree-hint">{t('tree.empty')}</div>}
          {renderLevel(root, node.entries, 0)}
        </div>
      )}
      {menu !== null && (
        <TreeContextMenu x={menu.x} y={menu.y} items={menuItems} t={t} onClose={closeMenu} />
      )}
    </div>
  );
});

/** Rendered children of one expanded directory (loading state handled here). */
function DirChildren({ node, depth, t, onRender }: {
  node: DirNode;
  depth: number;
  t: Translator;
  onRender: (path: string, entries: FileEntry[], depth: number) => React.ReactNode;
}): JSX.Element | null {
  if (node === undefined || node.entries === null) {
    return <div className="dshf-tree-hint" style={{ paddingLeft: `${8 + depth * 14}px` }}>{node?.error ? format(t('tree.loadFailed'), { message: node.error }) : t('tree.loading')}</div>;
  }
  return <>{onRender(node.path, node.entries, depth)}</>;
}

/**
 * VS Code-style inline input row: appears inside the tree for creation drafts
 * and in place of the node label for renames. Enter submits (the handler may
 * veto and keep the input open), Esc / blur cancels.
 */
function InlineInput({ depth, isDir, initial, t, onSubmit, onCancel }: {
  depth: number;
  isDir: boolean;
  initial: string;
  t: Translator;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    el.focus();
    // VS Code pre-selects the basename without its extension on rename.
    const dot = initial.lastIndexOf('.');
    if (initial !== '' && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial]);

  return (
    <div className="dshf-node dshf-node-editing" style={{ paddingLeft: `${8 + depth * 14}px` }}>
      <span className="dshf-caret" />
      <span className={cx('dshf-icon', isDir ? 'dshf-icon-dir' : 'dshf-icon-file')}>{isDir ? '📁' : '📄'}</span>
      <input
        ref={inputRef}
        className="dshf-inline-input"
        value={value}
        placeholder={initial === '' ? (isDir ? t('tree.directoryPlaceholder') : t('tree.filePlaceholder')) : undefined}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void onSubmit(value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
    </div>
  );
}
