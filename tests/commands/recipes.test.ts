import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientWithContext: vi.fn(),
  output: vi.fn(),
}));

vi.mock('../../src/lib/context.js', () => ({
  createClientWithContext: mocks.createClientWithContext,
}));

vi.mock('../../src/output/index.js', () => ({ output: mocks.output }));

import { recipesList } from '../../src/commands/recipes/list.js';
import { recipesGet } from '../../src/commands/recipes/get.js';
import { recipesApps } from '../../src/commands/recipes/apps.js';
import { recipesAdd, buildInstantiateBody, parseAfter } from '../../src/commands/recipes/add.js';
import { CliUsageError } from '../../src/lib/errors.js';
import type { BIQRecipeMetadata } from '../../src/client/types.js';

const command = { parent: { parent: { opts: () => ({ json: true }) } } };

const segment: BIQRecipeMetadata = {
  id: 'RCPE01hrsqaqq69wq4fwd1qzzebd1a', kind: 'SEGMENT', accessLevel: 'PUBLIC', isBorgiqTemplate: true,
  name: 'Summarize and post to Slack', description: 'OpenAI → Slack', color: '#000', tags: 'openai, slack', schemaVersion: 1,
  actorCount: 2,
  apps: [{ id: 'TAPP01a', name: 'OpenAI', color: '#000' }, { id: 'TAPP01b', name: 'Slack', color: '#000' }],
  settingsCount: { connections: 2, credentials: 0, inputs: 3 },
} as unknown as BIQRecipeMetadata;

const makeClient = () => ({
  listRecipes: vi.fn().mockResolvedValue({ total: 1, data: [segment] }),
  getRecipe: vi.fn().mockResolvedValue({ ...segment, data: { schemaVersion: '1', actors: {} }, entry: { actorId: 'ACTR01a' }, exit: { actorId: 'ACTR01b', portId: 'SPRTdefault' }, settings: { connections: [], credentials: [], inputs: [] } }),
  listRecipeApps: vi.fn().mockResolvedValue({ total: 1, data: [{ id: 'TAPP01a', name: 'OpenAI', color: '#000' }] }),
  instantiateRecipe: vi.fn().mockResolvedValue({ actorIds: ['ACTR01x', 'ACTR01y'], entryActorId: 'ACTR01x', exitActorId: 'ACTR01y', edgeIds: ['EDGE01z'] }),
});

let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
});

afterEach(() => {
  stderr.mockRestore();
  exit.mockRestore();
});

describe('recipes list', () => {
  it('passes kinds and app id through and flattens apps and settings for the table', async () => {
    await recipesList({ kind: ['segment', 'FLOW'], appId: 'TAPP01a' }, command);
    expect(client.listRecipes).toHaveBeenCalledWith('test-org', 'test-workspace', expect.objectContaining({ kinds: ['SEGMENT', 'FLOW'], appId: 'TAPP01a' }));
    const [result] = mocks.output.mock.calls[0];
    expect(result.data[0]).toMatchObject({ appNames: 'OpenAI, Slack', setup: '2 conn / 0 cred / 3 inputs' });
  });

  it('rejects an unknown kind', async () => {
    await expect(recipesList({ kind: ['PIPELINE'] }, command)).rejects.toThrow(/exit:/);
    expect(client.listRecipes).not.toHaveBeenCalled();
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/--kind must be one of/);
  });
});

describe('recipes get / apps', () => {
  it('outputs the full recipe', async () => {
    await recipesGet('RCPE01hrsqaqq69wq4fwd1qzzebd1a', {}, command);
    expect(client.getRecipe).toHaveBeenCalledWith('test-org', 'test-workspace', 'RCPE01hrsqaqq69wq4fwd1qzzebd1a');
    expect(mocks.output.mock.calls[0][0]).toMatchObject({ entry: { actorId: 'ACTR01a' } });
  });

  it('lists the apps that hold recipes', async () => {
    await recipesApps({}, command);
    expect(client.listRecipeApps).toHaveBeenCalled();
    expect(mocks.output.mock.calls[0][0].data[0].name).toBe('OpenAI');
  });
});

describe('recipes add', () => {
  it('parses --after with and without a port', () => {
    expect(parseAfter('ACTR01a')).toEqual({ actorId: 'ACTR01a', portId: 'SPRTdefault' });
    expect(parseAfter('ACTR01a:SPRTdone000')).toEqual({ actorId: 'ACTR01a', portId: 'SPRTdone000' });
    expect(() => parseAfter('a:b:c')).toThrow(CliUsageError);
  });

  it('builds the body from the flags and reads settings from a file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'recipes-add-'));
    try {
      const file = path.join(dir, 'settings.yaml');
      writeFileSync(file, 'connections:\n  openai-bearer: my-openai\ninputs:\n  channel: "#triage"\n');
      const body = await buildInstantiateBody({ canvas: 'c', x: 10, y: 20, after: 'ACTR01a', settings: file });
      expect(body).toEqual({
        position: { x: 10, y: 20 },
        source: { actorId: 'ACTR01a', portId: 'SPRTdefault' },
        settings: { connections: { 'openai-bearer': 'my-openai' }, inputs: { channel: '#triage' } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses --after with --into-edge, a lone --x, and non-object settings', async () => {
    await expect(buildInstantiateBody({ canvas: 'c', after: 'ACTR01a', intoEdge: 'EDGE01a' })).rejects.toThrow(/either --after or --into-edge/);
    await expect(buildInstantiateBody({ canvas: 'c', x: 1 })).rejects.toThrow(/--x and --y go together/);
    const dir = mkdtempSync(path.join(tmpdir(), 'recipes-add-'));
    try {
      const file = path.join(dir, 'settings.yaml');
      writeFileSync(file, '- not\n- an object\n');
      await expect(buildInstantiateBody({ canvas: 'c', settings: file })).rejects.toThrow(/must be a JSON or YAML object/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calls the instantiate endpoint and outputs the new actor ids', async () => {
    await recipesAdd('RCPE01hrsqaqq69wq4fwd1qzzebd1a', { canvas: 'my-canvas', intoEdge: 'EDGE01a' }, command);
    expect(client.instantiateRecipe).toHaveBeenCalledWith('test-org', 'test-workspace', 'my-canvas', 'RCPE01hrsqaqq69wq4fwd1qzzebd1a', { edgeId: 'EDGE01a' });
    expect(mocks.output.mock.calls[0][0]).toMatchObject({ actorIds: ['ACTR01x', 'ACTR01y'], edgeIds: ['EDGE01z'] });
  });
});
