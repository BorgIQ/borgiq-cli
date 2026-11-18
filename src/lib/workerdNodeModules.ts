// The Node.js built-in modules a JavaScriptActor may import: the ones workerd's nodejs_compat
// provides at the actor's pinned compatibility settings, NOT the ones the host process knows
// (Node's or Bun's `isBuiltin()` would say yes to names workerd lacks, such as `ws`).
//
// Copied from borgiq-sandbox's packages/js-actor/src/build/node-modules.ts, which the actor's
// bundler judges `node:` imports against. Keep the two in sync: when that list changes, change
// this one the same way.

export const WORKERD_NODE_MODULES: readonly string[] = [
  "assert", "assert/strict", "async_hooks", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "diagnostics_channel", "dns", "dns/promises", "domain", "events", "fs",
  "fs/promises", "http", "http2", "https", "inspector", "inspector/promises", "module", "net", "os",
  "path", "path/posix", "path/win32", "perf_hooks", "process", "punycode", "querystring", "readline",
  "readline/promises", "repl", "sqlite", "stream", "stream/consumers", "stream/promises", "stream/web",
  "string_decoder", "sys", "test", "timers", "timers/promises", "tls", "trace_events", "tty", "url",
  "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib",
];

/** names Node resolves only with the `node:` prefix: a bare `test` or `sqlite` is an npm package */
const PREFIX_ONLY = new Set(["sqlite", "test"]);

const MODULES = new Set(WORKERD_NODE_MODULES);

/** `node:fs`, `node:fs/promises`, and (bare) `fs`, `events` …, judged against workerd, never the host */
export function isWorkerdNodeModule(specifier: string): boolean {
  if (specifier.startsWith("node:")) return MODULES.has(specifier.slice(5));
  return MODULES.has(specifier) && !PREFIX_ONLY.has(specifier);
}
