/**
 * Editor theme settings for the dsh-explorer-editor editor view (VS Code style).
 *
 * Holds the background / foreground (text) colors and font size, persists
 * them to localStorage, and derives the chrome (toolbar/status) shades from
 * the chosen background so the whole editor surface stays cohesive. Both the
 * Monaco editor and the CSS chrome read from here.
 */
import { useSyncExternalStore } from 'react';

/** The user-facing editor theme settings. */
export interface EditorThemeSettings {
  /** Editor + view background (6-digit hex). */
  background: string;
  /** Primary text color (6-digit hex). */
  foreground: string;
  /** Monaco / textarea font size in px. */
  fontSize: number;
}

/** Built-in presets, selectable from the theme panel dropdown. */
export const EDITOR_THEME_PRESETS: Record<string, EditorThemeSettings> = {
  light: { background: '#ffffff', foreground: '#1f2328', fontSize: 13 },
  dark: { background: '#1e1e1e', foreground: '#d4d4d4', fontSize: 13 },
  'one-dark': { background: '#282c34', foreground: '#abb2bf', fontSize: 13 },
  github: { background: '#ffffff', foreground: '#24292e', fontSize: 13 },
};

/** Display order of the presets in the dropdown. */
export const EDITOR_THEME_PRESET_ORDER: readonly string[] = ['light', 'dark', 'one-dark', 'github'];

/** Human labels for the presets. */
export const EDITOR_THEME_PRESET_LABELS: Record<string, string> = {
  light: '浅色',
  dark: '深色',
  'one-dark': 'One Dark',
  github: 'GitHub',
};

/** The default theme (light) used before any user preference is stored. */
export const DEFAULT_EDITOR_THEME: EditorThemeSettings = { ...EDITOR_THEME_PRESETS.light };

// ── tiny color helpers (hex only) ──────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Blend two hex colors: amount 0 → a, 1 → b. */
export function mixColors(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount);
}

/** Perceived luminance in [0, 1]. */
export function luminanceOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** True when the color reads as a light surface (Monaco base 'vs' vs 'vs-dark'). */
export function isLightColor(hex: string): boolean {
  return luminanceOf(hex) > 0.5;
}

// ── derived chrome shades ───────────────────────────────────────────────────

export interface EditorThemeChrome {
  /** Toolbar / status bar background. */
  chrome: string;
  /** Borders, chip hover, etc. */
  border: string;
  /** Secondary text (paths, hints). */
  muted: string;
  /** Tab chip background. */
  chip: string;
  /** Dirty / unsaved marker color. */
  dirty: string;
}

/** Derive the chrome palette from a theme's background/foreground. */
export function themeChrome(theme: EditorThemeSettings): EditorThemeChrome {
  const light = isLightColor(theme.background);
  const chrome = mixColors(theme.background, light ? '#000000' : '#ffffff', light ? 0.06 : 0.08);
  const border = mixColors(theme.background, light ? '#000000' : '#ffffff', light ? 0.22 : 0.18);
  const muted = mixColors(theme.foreground, theme.background, 0.45);
  const chip = mixColors(theme.background, light ? '#000000' : '#ffffff', light ? 0.05 : 0.06);
  const dirty = light ? '#c2410c' : '#e2c08d';
  return { chrome, border, muted, chip, dirty };
}

// ── persisted store ─────────────────────────────────────────────────────────

// v2: default theme is now light, and the key is versioned so existing dark
// preferences from the previous build do not override the new default.
const STORAGE_KEY = 'dsh-file:editor-theme:v2';

const HEX6 = /^#[0-9a-f]{6}$/i;

function load(): EditorThemeSettings {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<EditorThemeSettings>;
        if (typeof parsed?.background === 'string' && HEX6.test(parsed.background)
          && typeof parsed?.foreground === 'string' && HEX6.test(parsed.foreground)) {
          return {
            background: parsed.background.toLowerCase(),
            foreground: parsed.foreground.toLowerCase(),
            fontSize: typeof parsed.fontSize === 'number' && parsed.fontSize > 0 ? parsed.fontSize : 13,
          };
        }
      }
    }
  } catch { /* corrupted storage: fall back to default */ }
  return { ...DEFAULT_EDITOR_THEME };
}

let current: EditorThemeSettings = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): EditorThemeSettings {
  return current;
}

/** React hook: the current editor theme. */
export function useEditorTheme(): EditorThemeSettings {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Apply a partial theme update (persisted, live). */
export function setEditorTheme(partial: Partial<EditorThemeSettings>): void {
  current = { ...current, ...partial };
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch { /* quota / privacy mode: keep in-memory */ }
  emit();
}

/** Restore the default (light) theme. */
export function resetEditorTheme(): void {
  current = { ...DEFAULT_EDITOR_THEME };
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  emit();
}

/** The preset whose colors match the given theme, if any. */
export function presetIdOf(theme: EditorThemeSettings): string | undefined {
  for (const [id, preset] of Object.entries(EDITOR_THEME_PRESETS)) {
    if (preset.background === theme.background && preset.foreground === theme.foreground) return id;
  }
  return undefined;
}

// ── theme import / export (VS Code style JSON) ──────────────────────────────

/** A parsed, validated imported theme. */
export interface ImportedTheme {
  /** Optional name carried in the file. */
  name?: string;
  background: string;
  foreground: string;
  fontSize: number;
}

/**
 * Serialize the current theme for export. The payload carries both the
 * plugin's flat fields AND a VS Code workbench `colors` view, so the file can
 * be re-imported here or understood by VS Code tooling.
 */
export function exportThemeText(theme: EditorThemeSettings, name: string): string {
  return JSON.stringify({
    name,
    type: 'dsh-file-theme',
    version: 1,
    background: theme.background,
    foreground: theme.foreground,
    fontSize: theme.fontSize,
    colors: {
      'editor.background': theme.background,
      'editor.foreground': theme.foreground,
    },
  }, null, 2);
}

/**
 * Parse and validate an imported theme JSON.
 *
 * Accepted shapes:
 *  - this plugin's export (flat `background` / `foreground` / `fontSize`),
 *  - a VS Code workbench theme (`colors['editor.background']` /
 *    `colors['editor.foreground']`), optionally with a tokenColors array
 *    (ignored — syntax highlighting stays Monaco's built-in).
 * Throws a readable Error when the payload cannot be used.
 */
export function parseImportedTheme(text: string): ImportedTheme {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw themeError('invalid-json', 'File is not valid JSON');
  }
  if (typeof data !== 'object' || data === null) throw themeError('not-object', 'JSON content must be an object');
  const obj = data as Record<string, unknown>;

  let background = typeof obj.background === 'string' ? obj.background : undefined;
  let foreground = typeof obj.foreground === 'string' ? obj.foreground : undefined;

  // VS Code workbench colors fallback.
  if ((background === undefined || foreground === undefined)
    && typeof obj.colors === 'object' && obj.colors !== null) {
    const colors = obj.colors as Record<string, unknown>;
    if (background === undefined) background = typeof colors['editor.background'] === 'string' ? colors['editor.background'] : undefined;
    if (foreground === undefined) foreground = typeof colors['editor.foreground'] === 'string' ? colors['editor.foreground'] : undefined;
  }

  if (background === undefined || !HEX6.test(background)) {
    throw themeError('missing-background', 'Missing valid background color (#rrggbb required)');
  }
  if (foreground === undefined || !HEX6.test(foreground)) {
    throw themeError('missing-foreground', 'Missing valid foreground color (#rrggbb required)');
  }
  const fontSize = typeof obj.fontSize === 'number' && obj.fontSize > 0 ? obj.fontSize : 13;
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : undefined;
  return { name, background: background.toLowerCase(), foreground: foreground.toLowerCase(), fontSize };
}

/** Error carrying a stable `code` the UI maps to a localized message. */
function themeError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
