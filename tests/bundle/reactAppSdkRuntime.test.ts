/**
 * Behavioral tests for the vendored @borgiq/actors SDK stub — the session surface.
 *
 * The stub ships as template strings (REACT_APP_SDK_FILES), so these tests materialize it
 * into a temp project (with a stub `react` and a test `generated.js`) and import it for
 * real, driving the parent⇄iframe token bridge through a mocked window. Covered:
 *   - resolveSession maps the token claims to { id, userId, email, name, appSessionId }
 *   - `userId` is an alias of `id`
 *   - a token without an appSessionId claim yields `appSessionId: undefined` (degrade, not crash)
 *   - the session memo survives a same-session token re-post (the parent's pre-expiry refresh)
 *   - a re-posted token with a DIFFERENT appSessionId drops the memo, so the next
 *     getSession() resolves the new session (the re-login-without-reload fix)
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, afterEach } from 'vitest';

import { REACT_APP_SDK_FILES } from '../../src/lib/bundle/reactAppSdk.js';

const PARENT_ORIGIN = 'https://parent.borgiq.example';

/** Build an unsigned JWT-shaped token whose payload the SDK can decode. */
function fakeToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `hdr.${payload}.sig`;
}

type MessageHandler = (event: { origin: string; data: unknown }) => void;

interface BridgeWindow {
  handlers: MessageHandler[];
  postToken(token: string): void;
}

/** Install a minimal embedded-iframe window: captures message handlers, has a distinct parent. */
function installWindow(): BridgeWindow {
  const handlers: MessageHandler[] = [];
  const win = {
    addEventListener: (type: string, handler: MessageHandler) => {
      if (type === 'message') handlers.push(handler);
    },
    parent: {
      postMessage: () => { /* the SDK's initial token request — nothing to do */ },
    },
  };
  (globalThis as Record<string, unknown>).window = win;
  return {
    handlers,
    postToken(token: string) {
      for (const handler of handlers) {
        handler({ origin: PARENT_ORIGIN, data: { type: 'APP_ACTOR_WEBHOOK_TOKEN', token } });
      }
    },
  };
}

/** Materialize the SDK stub + a test generated.js + a stub react into a fresh temp dir and import it. */
async function loadSdk(): Promise<Record<string, CallableFunction>> {
  const dir = mkdtempSync(join(tmpdir(), 'borgiq-sdk-test-'));
  writeFileSync(join(dir, 'index.js'), REACT_APP_SDK_FILES['index.js']);
  writeFileSync(join(dir, 'generated.js'), [
    'export const endpoints = {};',
    "export const msgUrlPrefix = '';",
    `export const trustedParentOrigin = '${PARENT_ORIGIN}';`,
    "export const apiUrl = '';",
  ].join('\n'));
  const reactDir = join(dir, 'node_modules', 'react');
  mkdirSync(reactDir, { recursive: true });
  writeFileSync(join(reactDir, 'package.json'), JSON.stringify({ name: 'react', version: '19.0.0', type: 'module', main: './index.js' }));
  writeFileSync(join(reactDir, 'index.js'), [
    'export const useState = () => [undefined, () => {}];',
    'export const useCallback = (fn) => fn;',
    'export const useRef = (v) => ({ current: v });',
    'export const useEffect = () => {};',
  ].join('\n'));
  return await import(pathToFileURL(join(dir, 'index.js')).href) as Record<string, CallableFunction>;
}

const flushMicrotasks = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('reactAppSdk session surface', () => {
  it('resolves { id, userId, email, name, appSessionId } from the token claims, with userId aliasing id', async () => {
    const bridge = installWindow();
    const sdk = await loadSdk();

    const pending = sdk.getSession() as Promise<Record<string, unknown>>;
    bridge.postToken(fakeToken({
      userId: 'USER0000000000000000000000test',
      userName: 'Ada',
      userEmail: 'ada@borgiq-test.example',
      appSessionId: 'APSN0000000000000000000000test',
    }));
    const session = await pending;

    expect(session).toEqual({
      id: 'USER0000000000000000000000test',
      userId: 'USER0000000000000000000000test',
      email: 'ada@borgiq-test.example',
      name: 'Ada',
      appSessionId: 'APSN0000000000000000000000test',
    });
    expect(session.userId).toBe(session.id);
  });

  it('yields appSessionId undefined for a token that predates the claim', async () => {
    const bridge = installWindow();
    const sdk = await loadSdk();

    const pending = sdk.getSession() as Promise<Record<string, unknown>>;
    bridge.postToken(fakeToken({ userId: 'USER0000000000000000000000old0' }));
    const session = await pending;

    expect(session.id).toBe('USER0000000000000000000000old0');
    expect(session.appSessionId).toBeUndefined();
    expect(session.email).toBe('');
    expect(session.name).toBe('');
  });

  it('keeps the memo across a same-session token re-post, and drops it when appSessionId changes', async () => {
    const bridge = installWindow();
    const sdk = await loadSdk();

    const firstLoginToken = fakeToken({ userId: 'USER0000000000000000000000usr1', appSessionId: 'APSN0000000000000000000000ses1' });
    const pending = sdk.getSession() as Promise<Record<string, unknown>>;
    bridge.postToken(firstLoginToken);
    const first = await pending;
    expect(first.appSessionId).toBe('APSN0000000000000000000000ses1');

    // The parent's pre-expiry refresh: a NEW token for the SAME login — same appSessionId claim.
    bridge.postToken(fakeToken({ userId: 'USER0000000000000000000000usr1', appSessionId: 'APSN0000000000000000000000ses1' }));
    await flushMicrotasks();
    const afterRefresh = sdk.getSession() as Promise<Record<string, unknown>>;
    expect(afterRefresh).toBe(pending); // memo kept — the very same promise instance

    // A re-login without a reload: the re-posted token carries a DIFFERENT appSessionId.
    bridge.postToken(fakeToken({ userId: 'USER0000000000000000000000usr2', appSessionId: 'APSN0000000000000000000000ses2' }));
    await flushMicrotasks();
    const afterRelogin = sdk.getSession() as Promise<Record<string, unknown>>;
    expect(afterRelogin).not.toBe(pending); // memo dropped — re-resolves from the new token
    const second = await afterRelogin;
    expect(second.appSessionId).toBe('APSN0000000000000000000000ses2');
    expect(second.userId).toBe('USER0000000000000000000000usr2'); // the stale-userId footgun is gone too
  });
});
