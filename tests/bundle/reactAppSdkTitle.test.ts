/**
 * Behavioral tests for the vendored @borgiq/actors SDK stub — the tab-title surface.
 *
 * The stub ships as template strings (REACT_APP_SDK_FILES), so these tests materialize it into a
 * temp project and import it for real, beside a small stand-in for `react` that renders function
 * components the way React does where it matters here: a ref belongs to one component instance,
 * and a commit runs every cleanup first and then every effect, children before parents. Covered:
 *   - embedded in BorgIQ, `setTitle` posts `{ type: 'SET_APP_ACTOR_TITLE', title }` to the trusted
 *     parent origin and nowhere else, and leaves the iframe's own document alone
 *   - `setTitle(null)` withdraws the title — back to a mounted `useTitle`, else to the host — and
 *     nothing is posted before a title was ever set
 *   - under `npm run dev` (the stub's own generated.js) it writes `document.title` and restores it
 *   - `useTitle`: a page outranks its layout, a title change re-claims, a route change posts once,
 *     unmount gives the title back
 *   - a send that throws is retried a bounded number of times
 *   - nothing throws without a window
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, afterEach, vi } from 'vitest';

import { REACT_APP_SDK_FILES } from '../../src/lib/bundle/reactAppSdk.js';

const PARENT_ORIGIN = 'https://parent.borgiq.example';

interface Posted { data: unknown; origin: string }
type Component = () => void;
interface FakeReact {
  /** render these components in order (parents first), then commit */
  render: (...components: Component[]) => void;
  /** unmount these components and mount those, in ONE commit — a route change */
  swap: (unmounting: Component[], mounting: Component[]) => void;
  unmount: (...components: Component[]) => void;
}

// The stand-in for `react`. Each component function is one mounted instance, keyed by identity.
const FAKE_REACT = `
const instances = new Map(); // component → { refs, effects }
let current = null;
export const useState = () => [undefined, () => {}];
export const useCallback = (fn) => fn;
export const useRef = (initial) => {
  const i = current.refIndex++;
  if (!(i in current.refs)) current.refs[i] = { current: initial };
  return current.refs[i];
};
export const useEffect = (fn, deps) => {
  const i = current.effectIndex++;
  const previous = current.effects[i];
  const changed = !previous || !deps || deps.some((dep, k) => dep !== previous.deps[k]);
  current.effects[i] = { fn, deps, cleanup: previous && previous.cleanup, pending: changed };
};
function renderOne(component) {
  if (!instances.has(component)) instances.set(component, { refs: [], effects: [] });
  current = instances.get(component);
  current.refIndex = 0;
  current.effectIndex = 0;
  component();
  current = null;
}
function cleanupAll(component) {
  for (const effect of instances.get(component).effects) if (typeof effect.cleanup === 'function') effect.cleanup();
  instances.delete(component);
}
// One commit: unmount cleanups and the cleanups of changed effects first, then the effects — each
// pass children before parents, which is the reverse of render order.
function commit(unmounting, rendered) {
  for (const component of [...unmounting].reverse()) cleanupAll(component);
  const childFirst = [...rendered].reverse();
  for (const component of childFirst) {
    for (const effect of instances.get(component).effects) {
      if (effect.pending && typeof effect.cleanup === 'function') effect.cleanup();
    }
  }
  for (const component of childFirst) {
    for (const effect of instances.get(component).effects) {
      if (!effect.pending) continue;
      effect.pending = false;
      effect.cleanup = effect.fn();
    }
  }
}
export const render = (...components) => { components.forEach(renderOne); commit([], components); };
export const swap = (unmounting, mounting) => { mounting.forEach(renderOne); commit(unmounting, mounting); };
export const unmount = (...components) => commit(components, []);
`;

/** The stub delivers once per tick; wait for that delivery. */
const delivered = (): Promise<void> => Promise.resolve();

const tempDirs: string[] = [];

/** Install an embedded-iframe window whose parent records what is posted to it. */
function installEmbeddedWindow(): { posted: Posted[]; titles: () => unknown[]; document: { title: string }; parent: { postMessage: (data: unknown, origin: string) => void } } {
  const posted: Posted[] = [];
  const document = { title: 'Vite App' };
  const parent = { postMessage: (data: unknown, origin: string) => { posted.push({ data, origin }); } };
  (globalThis as Record<string, unknown>).window = {
    addEventListener: () => { /* the token bridge — not under test */ },
    document,
    parent,
  };
  return { posted, titles: () => posted.map((p) => (p.data as { title: unknown }).title), document, parent };
}

/** Install a top-level window (local dev): `parent` is the window itself. */
function installTopLevelWindow(): { document: { title: string } } {
  const document = { title: 'Vite App' };
  const win: Record<string, unknown> = { addEventListener: () => {}, document };
  win.parent = win;
  (globalThis as Record<string, unknown>).window = win;
  return { document };
}

/**
 * Materialize the SDK stub into a fresh temp dir and import it. With a `trustedParentOrigin` the
 * build data is what the platform would bake; without one it is the stub's own `generated.js`,
 * which is what a pulled project runs under `npm run dev`.
 */
async function loadSdk(trustedParentOrigin?: string): Promise<{ sdk: Record<string, CallableFunction>; react: FakeReact }> {
  const dir = mkdtempSync(join(tmpdir(), 'borgiq-sdk-title-test-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'index.js'), REACT_APP_SDK_FILES['index.js']);
  writeFileSync(join(dir, 'generated.js'), trustedParentOrigin === undefined
    ? REACT_APP_SDK_FILES['generated.js']
    : [
      'export const endpoints = {};',
      "export const msgUrlPrefix = '';",
      `export const trustedParentOrigin = '${trustedParentOrigin}';`,
      "export const apiUrl = '';",
    ].join('\n'));
  const reactDir = join(dir, 'node_modules', 'react');
  mkdirSync(reactDir, { recursive: true });
  writeFileSync(join(reactDir, 'package.json'), JSON.stringify({ name: 'react', version: '19.0.0', type: 'module', main: './index.js' }));
  writeFileSync(join(reactDir, 'index.js'), FAKE_REACT);
  const sdk = await import(pathToFileURL(join(dir, 'index.js')).href) as Record<string, CallableFunction>;
  const react = await import(pathToFileURL(join(reactDir, 'index.js')).href) as FakeReact;
  return { sdk, react };
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).window;
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('reactAppSdk tab title surface', () => {
  it('embedded: setTitle posts the title to the trusted parent origin and leaves the iframe document alone', async () => {
    const { posted, document } = installEmbeddedWindow();
    const { sdk } = await loadSdk(PARENT_ORIGIN);

    sdk.setTitle('Orders');
    await delivered();
    sdk.setTitle('Orders'); // unchanged — not re-posted
    await delivered();

    expect(posted).toEqual([{ data: { type: 'SET_APP_ACTOR_TITLE', title: 'Orders' }, origin: PARENT_ORIGIN }]);
    expect(document.title).toBe('Vite App');
  });

  it('embedded: null withdraws the title, and nothing is posted before a title was ever set', async () => {
    const { titles } = installEmbeddedWindow();
    const { sdk } = await loadSdk(PARENT_ORIGIN);

    for (const blank of [null, undefined, '   ', 42]) {
      sdk.setTitle(blank);
      await delivered();
    }
    expect(titles()).toEqual([]);

    sdk.setTitle('Orders');
    await delivered();
    sdk.setTitle(null);
    await delivered();
    expect(titles()).toEqual(['Orders', null]);
  });

  it('local dev (the stub\'s own build data): writes document.title, posts nothing, and restores the original on clear', async () => {
    const { document } = installTopLevelWindow();
    const posted: unknown[] = [];
    ((globalThis as Record<string, unknown>).window as Record<string, unknown>).parent = { postMessage: (data: unknown) => { posted.push(data); } };
    const { sdk } = await loadSdk();

    sdk.setTitle('Orders');
    await delivered();
    expect(document.title).toBe('Orders');
    sdk.setTitle(null);
    await delivered();
    expect(document.title).toBe('Vite App');
    expect(posted).toEqual([]);
  });

  it('useTitle: a page outranks its layout, a title change re-claims, and unmount gives the title back', async () => {
    const { titles } = installEmbeddedWindow();
    const { sdk, react } = await loadSdk(PARENT_ORIGIN);

    let pageTitle: string | null = null;
    const Layout: Component = () => { sdk.useTitle('Acme'); };
    const Page: Component = () => { sdk.useTitle(pageTitle); };

    // The layout renders first, but the page's effect runs first: the page must still win.
    react.render(Layout, Page);
    await delivered();
    expect(titles()).toEqual(['Acme']); // the page is still loading and claims nothing

    pageTitle = 'Order 7';
    react.render(Layout, Page);
    await delivered();
    expect(titles()).toEqual(['Acme', 'Order 7']);

    pageTitle = 'Order 8';
    react.render(Layout, Page);
    await delivered();
    expect(titles()).toEqual(['Acme', 'Order 7', 'Order 8']);

    react.render(Layout, Page); // nothing changed
    await delivered();
    expect(titles()).toEqual(['Acme', 'Order 7', 'Order 8']);

    react.unmount(Page);
    await delivered();
    expect(titles()).toEqual(['Acme', 'Order 7', 'Order 8', 'Acme']);

    react.unmount(Layout);
    await delivered();
    expect(titles()).toEqual(['Acme', 'Order 7', 'Order 8', 'Acme', null]);
  });

  it('useTitle: a route change posts the new title once, never the title underneath in between', async () => {
    const { titles } = installEmbeddedWindow();
    const { sdk, react } = await loadSdk(PARENT_ORIGIN);

    const Orders: Component = () => { sdk.useTitle('Orders'); };
    const Customers: Component = () => { sdk.useTitle('Customers'); };

    react.render(Orders);
    await delivered();
    react.swap([Orders], [Customers]);
    await delivered();

    expect(titles()).toEqual(['Orders', 'Customers']);
  });

  it('setTitle outranks the hooks mounted when it is called, a later hook outranks it, and null hands back to a hook', async () => {
    const { titles } = installEmbeddedWindow();
    const { sdk, react } = await loadSdk(PARENT_ORIGIN);

    const Orders: Component = () => { sdk.useTitle('Orders'); };
    const Customers: Component = () => { sdk.useTitle('Customers'); };

    react.render(Orders);
    await delivered();
    sdk.setTitle('Saving…');
    await delivered();
    sdk.setTitle(null);
    await delivered();
    expect(titles()).toEqual(['Orders', 'Saving…', 'Orders']);

    sdk.setTitle('Saving…');
    await delivered();
    react.swap([Orders], [Customers]);
    await delivered();
    expect(titles()).toEqual(['Orders', 'Saving…', 'Orders', 'Saving…', 'Customers']);
  });

  it('a send that throws is retried three times and then given up on; one that recovers is delivered once', async () => {
    vi.useFakeTimers();
    const { titles, parent } = installEmbeddedWindow();
    const accept = parent.postMessage;
    let attempts = 0;
    let failing = true;
    parent.postMessage = (data, origin) => {
      attempts += 1;
      if (failing) throw new Error('detached');
      accept(data, origin);
    };
    const { sdk } = await loadSdk(PARENT_ORIGIN);

    sdk.setTitle('Orders');
    await delivered();
    expect(attempts).toBe(1);
    vi.advanceTimersByTime(500 + 1000 + 1500);
    expect(attempts).toBe(4);
    vi.advanceTimersByTime(60_000);
    sdk.setTitle('Orders'); // given up on: asking again does not start over
    await delivered();
    expect(attempts).toBe(4);

    // a different title fails once, then the parent accepts the retry
    sdk.setTitle('Customers');
    await delivered();
    expect(attempts).toBe(5);
    failing = false;
    vi.advanceTimersByTime(500);
    expect(attempts).toBe(6);
    expect(titles()).toEqual(['Customers']);
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBe(6);
  });

  it('never throws without a window', async () => {
    const { sdk, react } = await loadSdk(PARENT_ORIGIN);
    expect(() => sdk.setTitle('Orders')).not.toThrow();
    expect(() => react.render(() => { sdk.useTitle('Orders'); })).not.toThrow();
    await delivered();
  });
});
