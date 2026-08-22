/**
 * Markdown rendering for the dsh-explorer-editor editor view.
 *
 * Uses `marked` (bundled into the client via esbuild — no CDN dependency).
 * GFM is enabled; `breaks: true` makes single newlines render as <br> (the
 * behavior most chat/README documents expect). Rendering never throws: any
 * failure falls back to the raw text inside a <pre> so the preview pane can
 * never go blank.
 */
import { marked } from 'marked';

// Security: `marked` passes raw HTML straight through by default (its old
// `sanitize` option was removed upstream). A workspace .md file is not
// trusted, so escape raw HTML blocks/inlines — script and event-handler tags
// render as plain text instead of executing in the preview.
marked.use({
  renderer: {
    html({ text }: { text: string }): string {
      return escapeHtml(text);
    },
  },
});

/** Render Markdown text to an HTML string (GFM, soft-break enabled). */
export function renderMarkdown(text: string): string {
  try {
    const html = marked.parse(text, { gfm: true, breaks: true });
    return typeof html === 'string' ? html : String(html);
  } catch {
    // Never blank the preview: show the raw source in a <pre>.
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}

/** Whether a file path is a Markdown file (.md / .markdown, case-insensitive). */
export function isMarkdownPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = path.slice(dot + 1).toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

/** Minimal HTML escaping for the fallback path. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
