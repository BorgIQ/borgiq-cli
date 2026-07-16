/**
 * Vendored @borgiq/actors SDK stub.
 *
 * A React App project depends on @borgiq/actors as a local `file:` dependency, which the platform
 * swaps for the real SDK when it builds the app. Nothing resolves that path in a freshly pulled
 * bundle, so `npm install` fails and an editor flags every SDK import as missing. The CLI writes
 * these files once into the project, which closes that gap without taking ownership of them.
 *
 * This copy must stay in step with the SDK the platform's React App template expects: local
 * type-checking and `npm run dev` are only as accurate as it is. A build never uses this copy -
 * the platform always supplies its own.
 */

import { REACT_APP_TYPE, reactAppCodePrefix } from './reactApp.js';
import type { BundleFileMap, ExportedActor } from './types.js';

/** Write-once directory holding the vendored stub inside each React App project. */
export const SDK_PLACEHOLDER_DIR = '__borgiq_sdk_placeholder__';

const PACKAGE_JSON = `{
  "name": "@borgiq/actors",
  "version": "2.0.0",
  "type": "module",
  "main": "./index.js",
  "types": "./index.d.ts",
  "peerDependencies": {
    "react": ">=18"
  }
}
`;

const INDEX_JS = `// @borgiq/actors — the browser-side SDK for React App actors.
//
// Shipped build-free: plain dependency-free ESM (imports only \`react\`, which the host app already
// provides) so \`deno install\`, \`tsc\`, and Vite all consume it with no lifecycle scripts and no
// transpilation. The platform links it into user projects as a \`file:\` dependency.
//
// Public surface — a fetch-protocol surface, browser-fetch semantics against named endpoints:
//   useEndpoint(name, search?, init?)  — React hook: { data, loading, error, trigger }; does NOT auto-fetch
//   callEndpoint(name, search?, init?) — non-hook: Promise resolving to the parsed response body
//   getBasename()                      — router basename for the token path (from document.baseURI)
//
// Endpoints + token-bridge constants are BAKED into \`./generated.js\` when the platform builds the app.
// The parent⇄iframe token bridge lives HERE as an origin-checked module singleton: it attaches
// \`X-App-Actor-Token\` to SDK-issued fetches ONLY — there is NO global window.fetch patch. Raw fetch()
// calls are therefore not token-bridged in react apps; use the SDK.

import { useState, useCallback, useRef, useEffect } from 'react';
import { endpoints, msgUrlPrefix, trustedParentOrigin } from './generated.js';

/** Raised when \`name\` is not a declared endpoint on this app (not present in the baked endpoint map). */
export class EndpointNotFoundError extends Error {
  constructor(name) {
    super(\`No endpoint named "\${name}" is declared on this app. Add it in the editor: Settings → Endpoints, then Build.\`);
    this.name = 'EndpointNotFoundError';
    this.endpoint = name;
  }
}

/** Raised when an endpoint could not be resolved at build time (target deleted/moved/keyless). */
export class EndpointResolutionError extends Error {
  constructor(name, detail) {
    super(\`Endpoint "\${name}" could not be resolved: \${detail || 'unknown error'}.\`);
    this.name = 'EndpointResolutionError';
    this.endpoint = name;
  }
}

/** Raised on a non-2xx response from the endpoint; carries the status and the parsed body. */
export class EndpointHttpError extends Error {
  constructor(name, status, body) {
    super(\`Endpoint "\${name}" returned HTTP \${status}.\`);
    this.name = 'EndpointHttpError';
    this.endpoint = name;
    this.status = status;
    this.body = body;
  }
}

/** Raised when the app webhook token never arrived (app not embedded, or the token bridge timed out). */
export class TokenTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the app webhook token. Is the app running inside its BorgIQ iframe?');
    this.name = 'TokenTimeoutError';
  }
}

// ── Token bridge (origin-checked module singleton) ───────────────────────────────────────────────
// Post \`REQUEST_APP_ACTOR_WEBHOOK_TOKEN\` to the parent, receive \`{ type: 'APP_ACTOR_WEBHOOK_TOKEN',
// token }\` messages (origin-checked against the baked \`trustedParentOrigin\`), and update the stored
// token on every parent re-post (the parent refreshes the token before it expires). Lazily
// initialized on first SDK fetch so a non-embedded render is side-effect-free.

const TOKEN_WAIT_MS = 5000;
let bridge = null;

function getBridge() {
  if (bridge) return bridge;

  let token = null;
  let resolveFirstToken = null;
  const firstToken = new Promise((resolve) => { resolveFirstToken = resolve; });

  if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
      if (!trustedParentOrigin || event.origin !== trustedParentOrigin) return;
      if (event.data && event.data.type === 'APP_ACTOR_WEBHOOK_TOKEN') {
        token = event.data.token; // update on every re-post (parent refreshes before expiry)
        if (resolveFirstToken) { resolveFirstToken(); resolveFirstToken = null; }
      }
    });
    if (trustedParentOrigin && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'REQUEST_APP_ACTOR_WEBHOOK_TOKEN' }, trustedParentOrigin);
    }
  }

  bridge = {
    /** Resolve the current token, waiting up to TOKEN_WAIT_MS for the first one → TokenTimeoutError. */
    async getToken() {
      if (token) return token;
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new TokenTimeoutError()), TOKEN_WAIT_MS);
      });
      try {
        // clearTimeout in finally so a token win doesn't leave the 5s timer to fire (and reject the
        // now-unobserved \`timeout\` promise → unhandled rejection) or keep the event loop alive.
        await Promise.race([firstToken, timeout]);
      } finally {
        clearTimeout(timer);
      }
      return token;
    },
  };
  return bridge;
}

// ── Request helpers ──────────────────────────────────────────────────────────────────────────────

/** Append \`search\` (string | URLSearchParams | Record<string,string>) to a URL's query string. */
function appendSearch(url, search) {
  if (search === undefined || search === null || search === '') return url;
  let qs;
  if (typeof search === 'string') {
    qs = search.replace(/^\\?/, '');
  } else if (search instanceof URLSearchParams) {
    qs = search.toString();
  } else {
    qs = new URLSearchParams(search).toString();
  }
  if (!qs) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + qs;
}

/** Look up a baked endpoint, failing loudly by name. */
function resolveEndpoint(name) {
  const entry = endpoints[name];
  if (!entry) throw new EndpointNotFoundError(name);
  if (entry.error) throw new EndpointResolutionError(name, entry.error);
  if (!entry.url) throw new EndpointResolutionError(name, 'no URL was resolved');
  return entry;
}

/** Merge a base EndpointRequestInit with per-call overrides (headers merge; other fields override). */
function mergeInit(base, overrides) {
  if (!overrides) return base || {};
  if (!base) return overrides;
  const headers = new Headers(base.headers || undefined);
  new Headers(overrides.headers || undefined).forEach((value, key) => headers.set(key, value));
  return { ...base, ...overrides, headers };
}

/** Parse a response body as JSON when the content-type says so, else as text. */
async function parseResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (contentType.toLowerCase().indexOf('json') !== -1) {
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return text; // malformed JSON — hand back the raw text
    }
  }
  return text;
}

/**
 * Issue a browser fetch against a named endpoint with full fetch semantics. \`init.body\`
 * passes through untouched (URLSearchParams → form-encoded, FormData → multipart, string/Blob as-is);
 * headers merge with the SDK-added \`X-App-Actor-Token\`; non-2xx → EndpointHttpError(status, body).
 */
async function requestEndpoint(name, search, init) {
  const entry = resolveEndpoint(name);
  const url = appendSearch(entry.url, search);
  const opts = init || {};

  const headers = new Headers(opts.headers || undefined);
  // Attach the app-actor token to SDK-issued endpoint fetches only (all resolved endpoints are /msg/ URLs).
  if (!msgUrlPrefix || url.indexOf(msgUrlPrefix) === 0) {
    const token = await getBridge().getToken(); // may throw TokenTimeoutError
    if (token) headers.set('X-App-Actor-Token', token);
  }

  const response = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
    signal: opts.signal,
  });

  const body = await parseResponseBody(response);
  if (!response.ok) throw new EndpointHttpError(name, response.status, body);
  return body;
}

// ── Public surface ───────────────────────────────────────────────────────────────────────────────

/**
 * Call a declared endpoint by name with browser-fetch semantics; resolves with the parsed body.
 * Usable anywhere (event handlers, effects, non-component code).
 */
export async function callEndpoint(name, search, init) {
  return requestEndpoint(name, search, init);
}

/**
 * React hook — browser-fetch semantics against a named endpoint. Does NOT auto-fetch; call \`trigger()\`.
 * \`search\`/\`init\` supplied here are the defaults; \`trigger(overrides)\` merges per-call init overrides.
 *
 * Failures surface through the hook's \`error\` state, so \`trigger\` NEVER rejects — it resolves with the
 * call outcome \`{ data, error }\`, making the fire-and-forget \`onClick={() => trigger()}\` form safe (no
 * uncaught rejection). Await the result only if you want the outcome inline; for imperative use outside
 * a component (where a thrown error is idiomatic) reach for \`callEndpoint\`, which rejects on failure.
 *
 *   const { data, loading, error, trigger } = useEndpoint('login', '?page=1', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
 *     body: new URLSearchParams({ username, password }),
 *   });
 *   <button disabled={loading} onClick={() => trigger()}>Sign in</button>
 */
export function useEndpoint(name, search, init) {
  const [data, setData] = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track the latest args without re-creating \`trigger\`'s identity every render.
  const argsRef = useRef({ name, search, init });
  argsRef.current = { name, search, init };

  // Request-generation guard + in-flight abort: overlapping triggers must not commit a stale response
  // or clear \`loading\` early, and an unmounted component must not setState. Only the newest generation
  // (gated on \`gen === genRef.current\`, still mounted) commits; superseded/unmount aborts the fetch.
  const genRef = useRef(0);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const trigger = useCallback(async (overrides) => {
    const current = argsRef.current;
    const gen = ++genRef.current;
    if (abortRef.current) abortRef.current.abort(); // supersede any request still in flight
    const ac = new AbortController();
    abortRef.current = ac;

    // Honor a caller-supplied signal too — forward its abort to ours rather than clobbering it.
    const merged = mergeInit(current.init, overrides);
    if (merged.signal) {
      if (merged.signal.aborted) ac.abort();
      else merged.signal.addEventListener('abort', () => ac.abort(), { once: true });
    }

    const isCurrent = () => gen === genRef.current && mountedRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await requestEndpoint(current.name, current.search, { ...merged, signal: ac.signal });
      if (!isCurrent()) return { data: undefined, error: null };
      setData(result);
      return { data: result, error: null };
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      if (!isCurrent()) return { data: undefined, error: normalized };
      setError(normalized);
      return { data: undefined, error: normalized };
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  return { data, loading, error, trigger };
}

/**
 * Router basename for the token path (e.g. \`/v1/app/<token>/\`), read via \`document.baseURI\` from the
 * \`<base>\` tag the platform injects when it serves the app. Feed this to a router's \`basename\`
 * (React Router) so client-side routes resolve under the token root instead of the origin.
 */
export function getBasename() {
  if (typeof document !== 'undefined' && document.baseURI) {
    try {
      return new URL(document.baseURI).pathname;
    } catch {
      /* fall through */
    }
  }
  return '/';
}

export const version = '2.0.0';
`;

const INDEX_D_TS = `// Hand-maintained type declarations for @borgiq/actors (no build step). Fetch-protocol surface.

/** Search appended to an endpoint URL's query string. */
export type EndpointSearch = string | URLSearchParams | Record<string, string>;

/** The RequestInit subset honored by the SDK (browser-fetch semantics). \`body\` passes through untouched. */
export interface EndpointRequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
}

/**
 * Outcome of a {@link UseEndpointResult.trigger} call. \`trigger\` never rejects — failures surface here
 * (and in the hook's \`error\` state) — so the fire-and-forget \`onClick={() => trigger()}\` form is safe.
 */
export interface EndpointTriggerResult<T = unknown> {
  data: T | undefined;
  error: Error | null;
}

/** State + imperative trigger returned by {@link useEndpoint}. */
export interface UseEndpointResult<T = unknown> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  /**
   * Fire the request; \`overrides\` merge onto the hook's \`init\` (headers merge, other fields override).
   * Resolves with the call outcome and never rejects (failures land in \`error\`).
   */
  trigger: (overrides?: EndpointRequestInit) => Promise<EndpointTriggerResult<T>>;
}

export declare class EndpointNotFoundError extends Error {
  readonly name: 'EndpointNotFoundError';
  readonly endpoint: string;
  constructor(name: string);
}

export declare class EndpointResolutionError extends Error {
  readonly name: 'EndpointResolutionError';
  readonly endpoint: string;
  constructor(name: string, detail?: string);
}

export declare class EndpointHttpError extends Error {
  readonly name: 'EndpointHttpError';
  readonly endpoint: string;
  readonly status: number;
  readonly body: unknown;
  constructor(name: string, status: number, body: unknown);
}

export declare class TokenTimeoutError extends Error {
  readonly name: 'TokenTimeoutError';
  constructor();
}

/**
 * React hook — browser-fetch semantics against a named endpoint. Does not auto-fetch; call \`trigger()\`.
 * @param name   the declared endpoint name (the baked lookup key)
 * @param search appended to the endpoint URL's query string
 * @param init   default request init (method, headers, body, signal)
 */
export declare function useEndpoint<T = unknown>(name: string, search?: EndpointSearch, init?: EndpointRequestInit): UseEndpointResult<T>;

/** Non-hook form of {@link useEndpoint}; resolves with the parsed response body. */
export declare function callEndpoint<T = unknown>(name: string, search?: EndpointSearch, init?: EndpointRequestInit): Promise<T>;

/** Router basename for the token path (from \`document.baseURI\`, i.e. the injected \`<base>\` tag). */
export declare function getBasename(): string;

export declare const version: string;
`;

const GENERATED_JS = `// @borgiq/actors — GENERATED build data (checked-in STUB).
//
// When the platform builds the app it replaces this module with the app's baked endpoint map and
// token-bridge constants. This checked-in version is a stub so the SDK type-checks and imports
// resolve at dev time; if its values are ever seen at runtime the app was built WITHOUT the BorgIQ
// builder, so endpoint access fails loudly instead of silently no-opping.

const NOT_BUILT =
  'This app was not built by the BorgIQ react-app builder, so no endpoint data was baked in. '
  + 'Build the app from the BorgIQ editor.';

/** name → { url, authorizationLevel } | { error }. Real data is baked in at build time. */
export const endpoints = new Proxy({}, {
  get() { throw new Error(NOT_BUILT); },
});

/** The API's \`/msg/\` URL prefix — SDK endpoint fetches matching it receive the app-actor token. */
export const msgUrlPrefix = '';

/** The origin the token bridge trusts for postMessage. */
export const trustedParentOrigin = '';

/** The BorgIQ API base URL. */
export const apiUrl = '';
`;

const GENERATED_D_TS = `// Type declarations for the GENERATED build-data module. The platform replaces the \`.js\` when it
// builds the app, with the app's baked endpoint map + token-bridge constants.

/** A single baked endpoint: a callable URL (+ its authorization level), or a named build-time error. */
export type BakedEndpoint = { url: string; authorizationLevel?: string } | { error: string };

/** name → baked endpoint. Empty in the checked-in stub; filled with resolved endpoints at build time. */
export declare const endpoints: Record<string, BakedEndpoint>;

/** The API's \`/msg/\` URL prefix; SDK endpoint fetches matching it receive the app-actor token. */
export declare const msgUrlPrefix: string;

/** Origin the token bridge trusts for postMessage. */
export declare const trustedParentOrigin: string;

/** The BorgIQ API base URL. */
export declare const apiUrl: string;
`;

/** File name -> contents of the vendored @borgiq/actors stub package. */
export const REACT_APP_SDK_FILES: Readonly<Record<string, string>> = Object.freeze({
  'package.json': PACKAGE_JSON,
  'index.js': INDEX_JS,
  'index.d.ts': INDEX_D_TS,
  'generated.js': GENERATED_JS,
  'generated.d.ts': GENERATED_D_TS,
});

/**
 * The stub files for every React App actor in `actors`, keyed by bundle-relative path.
 *
 * Callers merge these into the write-once channel rather than the managed file map: the placeholder
 * is materialized on first write and left alone afterwards, and it is on the ignore list, so it is
 * never read back into a codeDir, never diffed, and never deleted.
 */
export const sdkPlaceholderCompanions = (actors: Iterable<ExportedActor>): BundleFileMap => {
  const files: BundleFileMap = {};
  for (const actor of actors) {
    if (actor.type !== REACT_APP_TYPE) continue;
    for (const [name, content] of Object.entries(REACT_APP_SDK_FILES)) {
      files[`${reactAppCodePrefix(actor.id)}${SDK_PLACEHOLDER_DIR}/${name}`] = content;
    }
  }
  return files;
};
