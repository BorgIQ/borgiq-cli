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
    expect(Object.keys(doc.data.actors)).toHaveLength(2);
  });

  it('wires a webhook trigger to a deno task with external code', () => {
    const files = buildStarterBundle({ name: 'My Flow', slug: 'my-flow' });
    const paths = Object.keys(files).sort();
    expect(paths.some((path) => path.startsWith('actors/triggers/webhook/'))).toBe(true);
    expect(paths.some((path) => /^actors\/tasks\/deno\/ACTR[a-z0-9]+\/code\/mod\.ts$/.test(path))).toBe(true);

    const { doc } = assembleBundle(files);
    const actors = Object.values(doc.data.actors);
    const trigger = actors.find((actor) => actor.type === 'WebhookTriggerActor')!;
    const task = actors.find((actor) => actor.type === 'DenoActor')!;
    const edges = Object.values(trigger.edges ?? {});
    expect(edges).toHaveLength(1);
    expect(edges[0].targetActorId).toBe(task.id);
    expect(typeof trigger.webhookTriggerKey).toBe('string');
    expect(task.configuration?.code).toContain('@borgiq/actors');
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

  it('.gitignore reserves the local dev artifacts dir', () => {
    expect(BUNDLE_GITIGNORE).toContain('.borgiq/');
  });
});
