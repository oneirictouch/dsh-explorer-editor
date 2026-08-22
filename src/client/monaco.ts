/**
 * Monaco Editor loader for the browser bundle.
 *
 * The client bundle cannot `require('monaco-editor')` — the ModuleLoader only
 * resolves platform seed words and other registered bundles. Instead we load
 * Monaco's official AMD loader from a CDN at runtime (the recommended
 * browser integration path), then `require(['vs/editor/editor.main'])` once.
 * Multiple mirrors are tried in order (jsDelivr → unpkg → Fastly jsDelivr) so
 * a single CDN outage degrades gracefully; an optional localStorage override
 * lets users point at a private/intranet mirror. If every mirror is
 * unreachable, the editor pane falls back to a plain textarea.
 */

const MONACO_VERSION = '0.52.2';

/** CDN mirrors tried in order (all serve the same official Monaco build). */
const MONACO_MIRRORS = [
  `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`,
  `https://unpkg.com/monaco-editor@${MONACO_VERSION}/min/vs`,
  `https://fastly.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`,
];

/** Optional user override (set in localStorage) to prefer a private mirror. */
const MONACO_MIRROR_OVERRIDE_KEY = 'dsh-file:monaco-mirror';

declare global {
  interface Window {
    require?: {
      config(options: Record<string, unknown>): void;
      (deps: string[], cb?: (...args: unknown[]) => void, errback?: (err: unknown) => void): void;
    };
    monaco?: unknown;
  }
}

export type Monaco = typeof import('monaco-editor');

let loading: Promise<Monaco> | null = null;
let failed = false;

/** Ordered list of base URLs to try, with the user override (if any) first. */
function mirrorBases(): string[] {
  let override: string | null = null;
  try {
    if (typeof localStorage !== 'undefined') override = localStorage.getItem(MONACO_MIRROR_OVERRIDE_KEY);
  } catch { /* ignore storage errors */ }
  if (override !== null && override.trim() !== '') return [override.trim(), ...MONACO_MIRRORS];
  return MONACO_MIRRORS;
}

/** Load Monaco's AMD loader script from one mirror base. */
function loadLoader(base: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = `${base}/loader.js`;
    el.async = true;
    el.addEventListener('load', () => resolve());
    el.addEventListener('error', () => reject(new Error(`failed to load monaco loader: ${base}`)));
    document.head.append(el);
  });
}

/**
 * Ensure Monaco is loaded and ready. Resolves with the `monaco` namespace.
 * Rejects if every mirror is unreachable; callers fall back to a textarea.
 */
export function ensureMonaco(): Promise<Monaco> {
  if (failed) return Promise.reject(new Error('monaco previously failed to load'));
  if (loading) return loading;
  loading = (async () => {
    for (const base of mirrorBases()) {
      // Stage 1: load the AMD loader script (network). A failed script tag is
      // harmless, so we can safely try the next mirror.
      try {
        await loadLoader(base);
      } catch {
        continue;
      }
      // Stage 2: configure the loader and require the editor main bundle.
      try {
        await new Promise<void>((resolve, reject) => {
          window.require!.config({ paths: { vs: base } });
          window.require!(['vs/editor/editor.main'], () => resolve(), (err: unknown) => reject(err));
        });
        return window.monaco as Monaco;
      } catch (error) {
        failed = true;
        loading = null;
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
    failed = true;
    loading = null;
    throw new Error('failed to load monaco loader from any mirror');
  })();
  return loading;
}

/** Whether Monaco failed to load previously (for fallback messaging). */
export function monacoUnavailable(): boolean {
  return failed;
}
