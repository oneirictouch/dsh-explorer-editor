/**
 * Build script for the dsh-explorer-editor plugin.
 *
 *  - Host half: compile src/index.ts → dist/index.js with `tsc`.
 *    MUST be tsc (not esbuild): the `@Remote()` decorators from
 *    @deepseek-ai/dsh-typert-protocol are stage-3 decorators, and esbuild
 *    lowers them to the legacy form (`__decorateClass`) whose context shape
 *    the runtime rejects. tsc emits `__esDecorate` (standard form), which the
 *    runtime accepts. Imports of @deepseek-ai/* are left external and resolve
 *    from the profile's node_modules at runtime.
 *  - Client half: bundle src/client/index.tsx → dist/client.js in the
 *    ModuleLoader handoff format:
 *
 *        window.__ModuleLoader__.load({ id: "dsh-explorer-editor", factory: (require) => {...} })
 *
 *    Platform seed words (react, @deepseek-ai/cordis, …) stay external so the
 *    browser module table resolves them; CSS is inlined as text and injected
 *    by the bundle itself. The client half uses no decorators, so esbuild is
 *    fine here.
 *
 * Usage:  node build.mjs [--watch]
 */
import { context } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const TSC_BIN = join(here, 'node_modules', 'typescript', 'bin', 'tsc');
const TSCONFIG_HOST = join(here, 'tsconfig.host.json');

// ModuleLoader platform seed words + graph rows the browser half can require.
// See getStaticModules() in @deepseek-ai/dsh-client-web.
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-api-gateway/client',
];

const CLIENT_BANNER = `
window.__ModuleLoader__.load({
  id: "dsh-explorer-editor",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`.trimStart();

const CLIENT_FOOTER = `
    return module.exports;
  }
});
`.trimStart();

mkdirSync('dist', { recursive: true });

// ── host half: tsc ─────────────────────────────────────────────────────────
// tsc cannot watch reliably across repeated invocations here, so in watch mode
// we rebuild once per change signal via a tiny poller. For non-watch, one pass.
function compileHost() {
  execFileSync(process.execPath, [
    TSC_BIN,
    '-p', TSCONFIG_HOST,
    '--pretty', 'false',
  ], { stdio: 'inherit' });
  console.log('[dsh-explorer-editor] host compiled → dist/index.js');
}

compileHost();

// ── client half: esbuild ───────────────────────────────────────────────────
const clientOptions = {
  bundle: true,
  sourcemap: false,
  logLevel: 'info',
  entryPoints: ['src/client/index.tsx'],
  outfile: 'dist/client.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: CLIENT_EXTERNALS,
  banner: { js: CLIENT_BANNER },
  footer: { js: CLIENT_FOOTER },
  loader: { '.css': 'text' },
};

if (watch) {
  // Watch BOTH halves: esbuild rebuilds the client bundle on change, and a
  // `tsc --watch` child process recompiles the host half (tsc cannot be
  // watched via repeated execFileSync invocations reliably).
  const hostWatcher = spawn(process.execPath, [
    TSC_BIN,
    '-p', TSCONFIG_HOST,
    '--watch',
    '--pretty', 'false',
  ], { stdio: 'inherit' });
  const ctx = await context(clientOptions);
  await ctx.watch();
  console.log('[dsh-explorer-editor] watching host (tsc --watch) + client (esbuild)…');
  const shutdown = async () => {
    hostWatcher.kill();
    await ctx.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  const { build } = await import('esbuild');
  await build(clientOptions);
  console.log('[dsh-explorer-editor] client bundle built → dist/client.js');
  console.log('[dsh-explorer-editor] build complete');
}
