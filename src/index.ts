/**
 * Host half of the dsh-explorer-editor plugin.
 *
 * Exposes a Typert Remote service (`fileManager`) that the browser client half
 * calls to list, read, write, create, rename, and delete files inside the
 * current conversation's workspace.
 *
 * IMPORTANT (SRC descriptor contract): the Typert gateway derives wire
 * parameter names from the method signature via Function.prototype.toString
 * — each method's parameter NAME is the wire field the client must send.
 * Methods therefore take FLAT parameters (e.g. `listDir(path: string)`, not
 * `listDir(input: {...})`), and the client's descriptors must mirror those
 * names exactly. No object-wrapping parameter.
 *
 * File operations use Node's fs directly (the plugin runs inside the host
 * process, so it shares the user's filesystem authority). All paths are
 * resolved against the workspace root pinned by configuration and rejected
 * when they escape it.
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import * as fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as nodePath from 'node:path';
import { mimeOf, BINARY_EXTENSIONS } from './mime.js';
import { decodeText } from './decode.js';
import { parentDirOf } from './parentDir.js';

/** One directory entry in a listing. */
export interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
  size?: number;
  /** Modified time in epoch ms, when the backend can report it. */
  mtimeMs?: number;
}

/** Result of listing one directory level. */
export interface ListDirResult {
  /** The canonical absolute path that was listed. */
  path: string;
  entries: FileEntry[];
}

/** Result of a text read. */
export interface ReadTextResult {
  path: string;
  content: string;
  /** Epoch ms of last modification, for change detection. */
  mtimeMs: number;
  /** Byte size. */
  size: number;
}

/** Result of a write. */
export interface WriteResult {
  path: string;
  operation: 'create' | 'update';
}

/**
 * Whether `candidate` is `root` itself or lives strictly under it (POSIX or
 * Windows separators). Returns false for sibling names like "..evil" and for
 * any path that escapes the root. Both inputs must already be normalized
 * absolute paths.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const rel = nodePath.relative(root, candidate);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(rel);
}

/**
 * Resolve an untrusted client path against the workspace root.
 *
 * Accepts either a root-relative path ("/", "src/a.ts", "dist/x/y.txt") or
 * an absolute path that stays inside the root. The parent directory is
 * realpath-verified, the leaf is realpath-verified when it already exists
 * (blocking symlink escapes), and the final resolved path must stay inside
 * the root. ".." segments that would escape are rejected.
 *
 * Operations that act on the link itself (delete / rename / copy) pass
 * `followLeaf: false` — they never read or write through the link's target,
 * so an escaping symlink may still be deleted, renamed, or copied as-is.
 */
export async function resolveInside(
  root: string,
  requested: string,
  options: { followLeaf?: boolean } = {},
): Promise<string> {
  const followLeaf = options.followLeaf ?? true;
  const rootReal = await fs.realpath(root);
  // Root-relative: strip a leading "/" and resolve "." / ".." segments.
  // Absolute: use as-is (the containment check below rejects escapes).
  const normalized = requested.replace(/\\/g, '/');
  const abs = nodePath.isAbsolute(normalized)
    ? nodePath.normalize(normalized)
    : nodePath.resolve(rootReal, normalized.replace(/^\/+/, ''));
  const parent = nodePath.dirname(abs);
  const parentReal = await fs.realpath(parent);
  const resolved = nodePath.join(parentReal, nodePath.basename(abs));
  if (!isPathInside(rootReal, resolved)) {
    throw new Error(`path escapes the workspace root: ${requested}`);
  }
  if (!followLeaf) return resolved;
  // When the leaf already exists, realpath it too: a symlink whose parent is
  // inside the root but whose target escapes it must be rejected.
  let resolvedReal: string;
  try {
    resolvedReal = await fs.realpath(resolved);
  } catch (error) {
    // ENOENT/ENOTDIR: the target does not exist yet (create flows) — allowed.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolved;
    throw error;
  }
  if (!isPathInside(rootReal, resolvedReal)) {
    throw new Error(`path escapes the workspace root: ${requested}`);
  }
  return resolved;
}

/**
 * The file manager gateway: file-system RPC endpoints consumed by the
 * browser client half.
 *
 * Every `@Remote` method takes flat parameters whose names are the wire
 * fields the client sends (SRC descriptor contract).
 */
export class FileManagerGateway extends TypertRemoteService {
  static inject: string[] = ['webServer'];

  /** Workspace root served by the gateway; re-pinnable via the setRoot RPC (falls back to config/process.cwd()). */
  private root: string;
  /**
   * Immutable fallback root (config.root ?? process.cwd()). `setRoot` may only
   * re-pin to a directory inside this root unless `allowArbitraryRoot` is set.
   */
  private readonly fallbackRoot: string;
  /** When true, `setRoot` may re-pin to any directory on the filesystem. */
  private readonly allowArbitraryRoot: boolean;
  private watcher: FSWatcher | null = null;
  private watcherRoot: string | null = null;
  private sseClients = new Set<ServerResponse>();
  private changedDirs = new Set<string>();
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: Context, config: { root?: string; allowArbitraryRoot?: boolean } = {}) {
    super(ctx, 'fileManager');
    this.fallbackRoot = nodePath.resolve(config.root ?? process.cwd());
    this.allowArbitraryRoot = config.allowArbitraryRoot === true;
    this.root = this.fallbackRoot;

    // Live tree refresh: push filesystem change events to the browser via SSE.
    const webServer = (ctx as unknown as {
      webServer: { register(spec: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }): void };
    }).webServer;
    webServer.register({ kind: 'prefix', path: '/dsh-explorer-editor/watch', handler: this.handleSse });
    this.ensureWatcher();
    this.heartbeat = setInterval(() => this.pingSse(), 25000);
    ctx.effect(() => () => {
      if (this.heartbeat !== null) clearInterval(this.heartbeat);
      if (this.changeTimer !== null) clearTimeout(this.changeTimer);
      if (this.watcher !== null) this.watcher.close();
      this.sseClients.clear();
    }, 'dsh-explorer-editor: watcher cleanup');
  }

  // ── SSE push channel (filesystem watch → browser) ────────────────────────

  private handleSse = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    this.sseClients.add(res);
    res.on('close', () => {
      this.sseClients.delete(res);
    });
  };

  private pingSse(): void {
    for (const res of this.sseClients) {
      try {
        res.write(': ping\n\n');
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  private broadcast(msg: { dirs: string[]; rootChanged: boolean }): void {
    const payload = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  /** Debounced flush of accumulated changed directories to the SSE clients. */
  private queueChange(dir: string): void {
    this.changedDirs.add(dir);
    if (this.changeTimer !== null) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      const dirs = [...this.changedDirs];
      this.changedDirs.clear();
      if (dirs.length > 0) this.broadcast({ dirs, rootChanged: false });
    }, 150);
  }

  /** (Re)start the recursive filesystem watcher for the current root. */
  private ensureWatcher(): void {
    if (this.watcherRoot === this.root) return;
    if (this.watcher !== null) {
      try { this.watcher.close(); } catch { /* ignore */ }
      this.watcher = null;
    }
    this.watcherRoot = this.root;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        const dir = filename == null ? this.root : parentDirOf(this.root, filename);
        this.queueChange(dir);
      });
    } catch (error) {
      console.warn(`[dsh-explorer-editor] fs.watch unavailable for ${this.root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Whether a file-like name should be treated as text (heuristic, case-insensitive). */
  private static isTextName(name: string): boolean {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return true; // no extension: treat as text (conservative)
    return !BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
  }

  /**
   * Read a file as a data URL (any type, binary included). The Markdown
   * preview uses this to display workspace-relative images that the web
   * server itself cannot serve.
   * @param path - target file path.
   */
  @Remote('readDataUrl')
  async readDataUrl(path: string): Promise<{ path: string; mime: string; dataUrl: string }> {
    const target = await resolveInside(this.root, path);
    const st = await fs.stat(target);
    if (!st.isFile()) throw new Error(`not a regular file: ${target}`);
    const MAX_BYTES = 5 * 1024 * 1024;
    if (st.size > MAX_BYTES) throw new Error(`file too large to inline as data URL (${st.size} bytes > ${MAX_BYTES})`);
    const buf = await fs.readFile(target);
    const mime = mimeOf(target);
    return { path: target, mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  }

  /**
   * List one directory level.
   * @param path - target directory path (absolute inside root, or relative to root).
   */
  @Remote('listDir')
  async listDir(path: string): Promise<ListDirResult> {
    const target = await resolveInside(this.root, path);
    const dirents = await fs.readdir(target, { withFileTypes: true });
    const entries: FileEntry[] = await Promise.all(dirents.map(async (dirent) => {
      const entry: FileEntry = {
        name: dirent.name,
        type: dirent.isDirectory() ? 'directory' : dirent.isFile() ? 'file' : 'other',
      };
      if (entry.type === 'file') {
        try {
          const st = await fs.stat(nodePath.join(target, dirent.name));
          entry.size = st.size;
          entry.mtimeMs = st.mtimeMs;
        } catch {
          // Unreadable metadata: keep the entry without it.
        }
      }
      return entry;
    }));
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
    return { path: target, entries };
  }

  /**
   * Read a text file (UTF-8). Binary files are rejected with a clear error.
   * @param path - target file path.
   */
  @Remote('readText')
  async readText(path: string): Promise<ReadTextResult> {
    const target = await resolveInside(this.root, path);
    if (!FileManagerGateway.isTextName(nodePath.basename(target))) {
      throw new Error(`refusing to read binary file: ${target}`);
    }
    const st = await fs.stat(target);
    if (!st.isFile()) throw new Error(`not a regular file: ${target}`);
    const MAX_BYTES = 5 * 1024 * 1024;
    if (st.size > MAX_BYTES) throw new Error(`file too large to open in the editor (${st.size} bytes > ${MAX_BYTES})`);
    const buf = await fs.readFile(target);
    return { path: target, content: decodeText(buf), mtimeMs: st.mtimeMs, size: st.size };
  }

  /**
   * Write a text file (create or overwrite).
   * @param path - target file path.
   * @param content - new file content.
   */
  @Remote('writeText')
  async writeText(path: string, content: string): Promise<WriteResult> {
    const target = await resolveInside(this.root, path);
    const exists = await fs.stat(target).then((s) => s.isFile()).catch(() => false);
    await fs.writeFile(target, content, 'utf8');
    return { path: target, operation: exists ? 'update' : 'create' };
  }

  /**
   * Create a new file at the target path (fails if it already exists).
   * @param path - target file path.
   */
  @Remote('createFile')
  async createFile(path: string): Promise<WriteResult> {
    const target = await resolveInside(this.root, path);
    const handle = await fs.open(target, 'wx');
    await handle.close();
    return { path: target, operation: 'create' };
  }

  /**
   * Create a directory at the target path (recursive, idempotent).
   * @param path - target directory path.
   */
  @Remote('createDirectory')
  async createDirectory(path: string): Promise<{ path: string }> {
    const target = await resolveInside(this.root, path);
    await fs.mkdir(target, { recursive: true });
    return { path: target };
  }

  /**
   * Rename or move a file/directory.
   * @param from - source path.
   * @param to - destination path.
   */
  @Remote('rename')
  async rename(from: string, to: string): Promise<{ from: string; to: string }> {
    const fromResolved = await resolveInside(this.root, from, { followLeaf: false });
    const toResolved = await resolveInside(this.root, to, { followLeaf: false });
    await fs.rename(fromResolved, toResolved);
    return { from: fromResolved, to: toResolved };
  }

  /**
   * Copy a file or directory (recursively) to a destination path. Fails when
   * the destination already exists (no silent overwrite).
   * @param from - source path.
   * @param to - destination path.
   */
  @Remote('copy')
  async copy(from: string, to: string): Promise<{ from: string; to: string }> {
    const fromResolved = await resolveInside(this.root, from, { followLeaf: false });
    const toResolved = await resolveInside(this.root, to, { followLeaf: false });
    await fs.cp(fromResolved, toResolved, { recursive: true });
    return { from: fromResolved, to: toResolved };
  }

  /**
   * Delete a file or empty directory. Non-empty directories are rejected
   * (the client walks children first).
   * @param path - target path.
   */
  @Remote('delete')
  async delete(path: string): Promise<{ path: string }> {
    const target = await resolveInside(this.root, path, { followLeaf: false });
    const st = await fs.lstat(target);
    if (st.isDirectory()) {
      const children = await fs.readdir(target);
      if (children.length > 0) throw new Error(`directory not empty: ${target}`);
      await fs.rmdir(target);
    } else {
      await fs.unlink(target);
    }
    return { path: target };
  }

  /**
   * Stat one path: tells the client whether a name is a file or directory.
   * @param path - target path.
   */
  @Remote('stat')
  async stat(path: string): Promise<{ path: string; type: 'file' | 'directory' | 'other'; size?: number; mtimeMs?: number }> {
    const target = await resolveInside(this.root, path);
    const st = await fs.stat(target);
    return {
      path: target,
      type: st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other',
      size: st.isFile() ? st.size : undefined,
      mtimeMs: st.mtimeMs,
    };
  }

  /** Resolve a path inside the root, returning the canonical form. */
  @Remote('resolve')
  async resolve(path: string): Promise<{ path: string }> {
    const target = await resolveInside(this.root, path);
    return { path: target };
  }

  /** Return the workspace root the gateway serves (the client's initial directory). */
  @Remote('getRoot')
  async getRoot(): Promise<{ path: string }> {
    this.ensureWatcher();
    return { path: this.root };
  }

  /**
   * Re-pin the workspace root the gateway serves. The browser calls this with
   * the CURRENT conversation's workspace directory (SessionHeader.cwd) when
   * the file manager opens, so the tree always reflects the session's
   * workspace instead of the process-launch directory. The path must exist
   * and be a directory; afterwards every operation resolves against it.
   * @param path - absolute workspace directory, or a path relative to the current root.
   */
  @Remote('setRoot')
  async setRoot(path: string): Promise<{ path: string }> {
    const abs = nodePath.isAbsolute(path)
      ? nodePath.normalize(path)
      : nodePath.resolve(this.root, path);
    const st = await fs.stat(abs);
    if (!st.isDirectory()) throw new Error(`not a directory: ${abs}`);
    const real = await fs.realpath(abs);
    if (!this.allowArbitraryRoot && !isPathInside(this.fallbackRoot, real)) {
      throw new Error(`workspace root escapes the allowed root: ${real} (set allowArbitraryRoot to permit it)`);
    }
    this.root = real;
    this.ensureWatcher();
    this.broadcast({ dirs: [], rootChanged: true });
    return { path: this.root };
  }
}

export default FileManagerGateway;
