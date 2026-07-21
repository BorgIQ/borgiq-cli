import { describe, expect, it } from 'vitest';

import { assembleBundle } from '../../src/lib/bundle/assemble.js';
import { BUNDLE_AGENTS_MD, BUNDLE_GITIGNORE, buildStarterBundle } from '../../src/lib/bundle/template.js';
import { validateBundle } from '../../src/lib/bundle/validate.js';

describe('buildStarterBundle', () => {
  it('passes strict validation and assembles', () => {
    const files = buildStarterBundle({ name: 'My Flow', slug: 'my-flow' });
    expect(validateBundle(files)).toEqual({ errors: [], warnings: [] });
    const { doc } = assembleBundle(files);
    expect(doc.metadata.slug).toBe('my-flow');
    expect(doc.metadata.name).toBe('My Flow');
    expect(Object.keys(doc.data.actors)).toHaveLength(3);
  });

  it('creates a webhook trigger, a test sender, and a deno task with external code', () => {
    const files = buildStarterBundle({ name: 'My Flow', slug: 'my-flow' });
    const paths = Object.keys(files).sort();
    expect(paths.some((path) => path.startsWith('actors/triggers/webhook/'))).toBe(true);
    expect(paths.some((path) => path.startsWith('actors/tasks/http-request/'))).toBe(true);
    expect(paths.some((path) => /^actors\/tasks\/deno\/ACTR[a-z0-9]+\/code\/mod\.ts$/.test(path))).toBe(true);

    const { doc } = assembleBundle(files);
    const actors = Object.values(doc.data.actors);
    const trigger = actors.find((actor) => actor.type === 'WebhookTriggerActor')!;
    const testSender = actors.find((actor) => actor.type === 'HttpRequestActor')!;
    const task = actors.find((actor) => actor.type === 'DenoActor')!;
    const edges = Object.values(trigger.edges ?? {});
    expect(edges).toHaveLength(1);
    expect(edges[0].targetActorId).toBe(task.id);
    expect(trigger.name).toBe('Incoming webhook');
    expect(trigger.msgVar).toBe('incoming_webhook');
    expect(trigger.webhookTriggerKey).toBeUndefined();
    expect(trigger.configuration?.webhook).toEqual({
      triggerKey: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      authorizationLevel: 'public',
      allowedMethods: ['get', 'post'],
      responseTimeout: 30,
    });
    expect(trigger.configuration?.options).toEqual({
      webhook: {
        respondImmediately: true,
        emitRawBody: false,
        response: {
          statusCode: 200,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
          },
          body: 'OK',
        },
      },
    });
    expect(testSender.name).toBe('Send test event');
    expect(testSender.msgVar).toBe('send_test_event');
    expect(testSender.configuration?.options).toEqual({
      url: '${{ ctx.canvas.webhookTriggers.incoming_webhook.url }}',
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: {
        message: 'Hello, world!',
      },
    });
    expect(task.configuration?.code).toContain('@borgiq/actors');
    expect(task.configuration?.code).toContain('denoVersion: Deno.version');
    expect(task.configuration?.code).toContain('denoBuild: Deno.build');
    expect(task.configuration?.code).toContain('ctx: req.ctx');
  });

  it('mints fresh ids per invocation', () => {
    const a = assembleBundle(buildStarterBundle({ name: 'A', slug: 'a-flow' })).doc;
    const b = assembleBundle(buildStarterBundle({ name: 'B', slug: 'b-flow' })).doc;
    expect(Object.keys(a.data.actors)).not.toEqual(Object.keys(b.data.actors));
  });
});

describe('bundle companion files', () => {
  it('AGENTS.md documents the contract and commands', () => {
    for (const needle of ['canvas.yaml', 'actor.yaml', 'codeDir', 'graph.nodes', 'bundle validate', 'bundle pack', 'bundle push', 'borgiq.canvas.bundle']) {
      expect(BUNDLE_AGENTS_MD).toContain(needle);
    }
  });

  it('AGENTS.md documents the react-app project contract', () => {
    for (const needle of [
      'React App actors',
      'src/assets/',
      '__borgiq_sdk_placeholder__/',
      '${{ assets["hero.png"] }}',
      'node_modules/',
      'borgiq assets delete',
      'options.files order is meaningful',
    ]) {
      expect(BUNDLE_AGENTS_MD).toContain(needle);
    }
  });

  it('AGENTS.md documents third-party dependencies and the build step', () => {
    for (const needle of [
      'Third-party dependencies',
      'Pin exact versions',
      'minimum dependency age',
      'postinstall',
      'one JS file and at most one CSS file',
      'allowInlineStyling',
      'resolve.dedupe',
      'borgiq bundle build',
    ]) {
      expect(BUNDLE_AGENTS_MD).toContain(needle);
    }
  });

  it('AGENTS.md shows how to reference an asset and call an endpoint', () => {
    for (const needle of [
      "import hero from './assets/hero.png'",
      'do not use public/',
      "useEndpoint('submitOrder')",
      'does not fetch on mount',
      'getBasename()',
      'is not authenticated',
    ]) {
      expect(BUNDLE_AGENTS_MD).toContain(needle);
    }
  });

  it('.gitignore reserves the local dev artifacts dir', () => {
    expect(BUNDLE_GITIGNORE).toContain('.borgiq/');
  });

  it('.gitignore excludes react-app local tooling output', () => {
    for (const needle of [
      'actors/*/react-app/*/code/node_modules/',
      'actors/*/react-app/*/code/dist/',
      'actors/*/react-app/*/code/.vite/',
      'actors/*/react-app/*/code/deno.lock',
      'actors/*/react-app/*/code/package-lock.json',
      'actors/*/react-app/*/code/npm-shrinkwrap.json',
      'actors/*/react-app/*/code/yarn.lock',
      'actors/*/react-app/*/code/pnpm-lock.yaml',
      'actors/*/react-app/*/code/bun.lockb',
      'actors/*/react-app/*/code/__borgiq_sdk_placeholder__/',
    ]) {
      expect(BUNDLE_GITIGNORE).toContain(needle);
    }
  });
});
