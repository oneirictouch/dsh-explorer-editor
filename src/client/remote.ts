/**
 * Client-side Remote contribution for the `fileManager` namespace.
 *
 * These descriptors mirror the `@Remote()` endpoints declared on the host
 * `FileManagerGateway` (src/index.ts). The client mounts them via
 * `ctx.remote.$mount(TYPERT_REMOTE)`, after which the namespace service
 * `remote.fileManager` exists. Because these descriptors are hand-written
 * (no generated artifacts), the typed face is provided by the small wrapper
 * below, which also unwraps the RemoteResult envelope into value-or-throw.
 */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';

/** Passthrough schema: accepts any JSON value unchanged. */
const passthrough = { parse: (value: unknown) => value };

/** One ordered business parameter (JSON-sourced, passthrough codec). */
const jsonParam = (name: string) => ({
  name,
  wire: name,
  source: 'json' as const,
  codec: { mode: 'strict' as const, typeSymbol: 'json', schema: passthrough },
});

/** Result codec (passthrough). */
const jsonResult = { mode: 'strict' as const, typeSymbol: 'json', schema: passthrough };

/** Build one direct-invocation descriptor. */
const direct = (method: string, parameters: string[]) => ({
  id: `dsh-explorer-editor#fileManager/${method}`,
  service: 'fileManager',
  namespace: 'fileManager',
  method,
  invocation: { kind: 'direct' as const },
  parameters: parameters.map(jsonParam),
  result: jsonResult,
});

/**
 * The remote contribution package `dsh-explorer-editor` mounts in the browser.
 * Mounting registers the namespace service; the UI plugin injects
 * `remote.fileManager` and calls the endpoints directly.
 *
 * Descriptors mirror the host gateway's FLAT parameter names (the Typert SRC
 * contract derives wire fields from method signatures), so each method's
 * parameters here are exactly the names used on the host.
 */
export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: 'dsh-explorer-editor',
  descriptors: [
    direct('listDir', ['path']),
    direct('readText', ['path']),
    direct('readDataUrl', ['path']),
    direct('writeText', ['path', 'content']),
    direct('createFile', ['path']),
    direct('createDirectory', ['path']),
    direct('rename', ['from', 'to']),
    direct('copy', ['from', 'to']),
    direct('delete', ['path']),
    direct('stat', ['path']),
    direct('resolve', ['path']),
    direct('getRoot', []),
    direct('setRoot', ['path']),
  ],
};

// ── business types shared with the host ────────────────────────────────────

export interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
  size?: number;
  mtimeMs?: number;
}

export interface ListDirValue {
  path: string;
  entries: FileEntry[];
}

export interface ReadTextValue {
  path: string;
  content: string;
  mtimeMs: number;
  size: number;
}

export interface ReadDataUrlValue {
  path: string;
  mime: string;
  dataUrl: string;
}

// ── typed remote face ──────────────────────────────────────────────────────

/**
 * The runtime-mounted namespace service face. `ctx.remote.fileManager` is a
 * `RemoteNamespaceService` whose direct methods resolve to `RemoteResult`.
 * The wrapper methods below unwrap to `{ value }` or throw the RemoteFailure.
 * Each method's arguments are FLAT (wire field names), matching the host
 * gateway's SRC descriptor contract.
 */
export interface FileManagerRemote {
  listDir(path: string): Promise<RemoteResult<ListDirValue>>;
  readText(path: string): Promise<RemoteResult<ReadTextValue>>;
  readDataUrl(path: string): Promise<RemoteResult<ReadDataUrlValue>>;
  writeText(path: string, content: string): Promise<RemoteResult<{ path: string; operation: 'create' | 'update' }>>;
  createFile(path: string): Promise<RemoteResult<{ path: string; operation: 'create' }>>;
  createDirectory(path: string): Promise<RemoteResult<{ path: string }>>;
  rename(from: string, to: string): Promise<RemoteResult<{ from: string; to: string }>>;
  copy(from: string, to: string): Promise<RemoteResult<{ from: string; to: string }>>;
  delete(path: string): Promise<RemoteResult<{ path: string }>>;
  stat(path: string): Promise<RemoteResult<{ path: string; type: 'file' | 'directory' | 'other'; size?: number; mtimeMs?: number }>>;
  resolve(path: string): Promise<RemoteResult<{ path: string }>>;
  getRoot(): Promise<RemoteResult<{ path: string }>>;
  setRoot(path: string): Promise<RemoteResult<{ path: string }>>;
}

/** Unwrap a RemoteResult: return `value`, throw a readable Error on failure. */
export function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value;
  const { code, message } = result.error;
  const err = new Error(`${message}${code ? ` (${code})` : ''}`);
  (err as { code?: string }).code = code;
  throw err;
}

// ── typed remote map merge ─────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    fileManager: FileManagerRemote;
  }
}
