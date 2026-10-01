/**
 * Behavioral tests for the vendored @borgiq/actors SDK stub — the tab-title surface.
 *
 * The stub ships as template strings (REACT_APP_SDK_FILES), so these tests materialize it into a
 * temp project (with a stub `react` and a test `generated.js`) and import it for real. Covered:
 *   - embedded in BorgIQ, `setTitle` posts `{ type: 'SET_APP_ACTOR_TITLE', title }` to the trusted
 *     parent origin and nowhere else, and leaves the iframe's own document alone
 *   - `setTitle(null)` withdraws the title, and nothing is posted before a title was ever set
 *   - under `npm run dev` (no trusted origin) it writes `document.title` and restores it on clear
 *   - `useTitle` claims on effect, and a later-rendered hook outranks an earlier one
 *   - nothing throws without a window
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, afterEach } from 'vitest';

import { REACT_APP_SDK_FILES } from '../../src/lib/bundle/reactAppSdk.js';

const PARENT_ORIGIN = 'https://parent.borgiq.example';

interface Posted { data: unknown; origin: string }

/** Install an embedded-iframe window whose parent records what is posted to it. */
function installEmbeddedWindow(): { posted: Posted[]; document: { title: string } } {
  const posted: Posted[] = [];
  const document = { title: 'Vite App' };
  (globalThis as Record<string, unknown>).window = {
    addEventListener: () => { /* the token bridge — not under test */ },
    document,
    parent: { postMessage: (data: unknown, origin: string) => { posted.push({ data, origin }); } },
  };
  return { posted, document };
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
 * Materialize the SDK stub into a fresh temp dir and import it. The stub `react` runs effects
 * immediately and collects their cleanups, which is enough to drive `useTitle` without a renderer.
 */
async function loadSdk(trustedParentOrigin: string): Promise<{ sdk: Record<string, CallableFunction>; unmountAll: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'borgiq-sdk-title-test-'));
  writeFileSync(join(dir, 'index.js'), REACT_APP_SDK_FILES['index.js']);
  writeFileSync(join(dir, 'generated.js'), [
    'export const endpoints = {};',
    "export const msgUrlPrefix = '';",
    `export const trustedParentOrigin = '${trustedParentOrigin}';`,
    "export const apiUrl = '';",
  ].join('\n'));
  const reactDir = join(dir, 'node_modules', 'react');
  mkdirSync(reactDir, { recursive: true });
  writeFileSync(join(reactDir, 'package.json'), JSON.stringify({ name: 'react', version: '19.0.0', type: 'module', main: './index.js' }));
  writeFileSync(join(reactDir, 'index.js'), [
    'export const cleanups = [];',
    'export const useState = () => [undefined, () => {}];',
    'export const useCallback = (fn) => fn;',
    'export const useRef = (v) => ({ current: v });',
    'export const useEffect = (fn) => { const cleanup = fn(); if (typeof cleanup === "function") cleanups.push(cleanup); };',
  ].join('\n'));
  const sdk = await import(pathToFileURL(join(dir, 'index.js')).href) as Record<string, CallableFunction>;
  const react = await import(pathToFileURL(join(reactDir, 'index.js')).href) as { cleanups: Array<() => void> };
  return { sdk, unmountAll: () => { while (react.cleanups.length) react.cleanups.pop()!(); } };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('reactAppSdk tab title surface', () => {
  it('embedded: setTitle posts the title to the trusted parent origin and leaves the iframe document alone', async () => {
    const { posted, document } = installEmbeddedWindow();
    const { sdk } = await loadSdk(PARENT_ORIGIN);

    sdk.setTitle('Orders');
    sdk.setTitle('Orders'); // unchanged — not re-posted

    expect(posted).toEqual([{ data: { type: 'SET_APP_ACTOR_TITLE', title: 'Orders' }, origin: PARENT_ORIGIN }]);
    expect(document.title).toBe('Vite App');
  });

  it('embedded: null withdraws the title, and nothing is posted before a title was ever set', async () => {
    const { posted } = installEmbeddedWindow();
    const { sdk } = await loadSdk(PARENT_ORIGIN);

    sdk.setTitle(null);
    sdk.setTitle('   ');
    sdk.setTitle(42);
    expect(posted).toEqual([]);

    sdk.setTitle('Orders');
    sdk.setTitle(null);
    expect(posted.map((p) => (p.data as { title: unknown }).title)).toEqual(['Orders', null]);
  });

  it('local dev (no trusted origin): writes document.title and restores the original on clear', async () => {
    const { document } = installTopLevelWindow();
    const { sdk } = await loadSdk('');

    sdk.setTitle('Orders');
    expect(document.title).toBe('Orders');
    sdk.setTitle(null);
    expect(document.title).toBe('Vite App');
  });

  it('useTitle claims the title, a later-rendered hook outranks an earlier one, and unmount gives it back', async () => {
    const { posted } = installEmbeddedWindow();
    const { sdk, unmountAll } = await loadSdk(PARENT_ORIGIN);
    const titles = () => posted.map((p) => (p.data as { title: unknown }).title);

    sdk.useTitle('Acme'); // a layout
    sdk.useTitle('Orders'); // the page inside it
    expect(titles()).toEqual(['Acme', 'Orders']);

    sdk.useTitle(null); // a deeper component still loading claims nothing
    expect(titles()).toEqual(['Acme', 'Orders']);

    unmountAll(); // deepest first: the page hands back to the layout, the layout to the host
    expect(titles()).toEqual(['Acme', 'Orders', 'Acme', null]);
  });

  it('never throws without a window', async () => {
    const { sdk } = await loadSdk(PARENT_ORIGIN);
    expect(() => sdk.setTitle('Orders')).not.toThrow();
    expect(() => sdk.useTitle('Orders')).not.toThrow();
  });
});
