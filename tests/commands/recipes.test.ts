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

import { recipesList, wiringOf } from '../../src/commands/recipes/list.js';
import { recipesGet, describeRecipe } from '../../src/commands/recipes/get.js';
import { recipesApps } from '../../src/commands/recipes/apps.js';
import { recipesAdd, buildInstantiateBody, parseAfter } from '../../src/commands/recipes/add.js';
import { CliUsageError } from '../../src/lib/errors.js';
import { ApiError, BorgIQClient } from '../../src/client/index.js';
import type { BIQRecipeDetail, BIQRecipeMetadata } from '../../src/client/types.js';

const command = { parent: { parent: { opts: () => ({ json: true }) } } };

const segment: BIQRecipeMetadata = {
  id: 'RCPE01hrsqaqq69wq4fwd1qzzebd1a', kind: 'SEGMENT', accessLevel: 'PUBLIC', isBorgiqRecipe: true,
  name: 'Summarize and post to Slack', description: 'An AI actor summarizes, Slack posts it', color: '#000', tags: 'ai, slack, summary', schemaVersion: 1,
  actorCount: 2,
  apps: [{ id: 'TAPP01a', name: 'BorgIQ Utils', color: '#000' }, { id: 'TAPP01b', name: 'Slack', color: '#000' }],
  settingsCount: { connections: 1, credentials: 0, inputs: 3 },
  entry: { actorId: 'ACTR01a' },
  exit: { actorId: 'ACTR01b', portId: 'SPRTdefault' },
};

/** an MCP server recipe: a TRIGGER nothing feeds and that feeds nothing */
const mcpServer: BIQRecipeMetadata = {
  ...segment, id: 'RCPE01mcp', kind: 'TRIGGER', name: 'MCP server', actorCount: 1, apps: [], settingsCount: { connections: 0, credentials: 0, inputs: 0 },
  entry: null, exit: null,
};

const segmentDetail: BIQRecipeDetail = {
  ...segment,
  data: { schemaVersion: '1', actors: {} },
  settings: {
    connections: [{ groupKey: 'slack-bearer|slack-oauth2', type: ['slack-oauth2', 'slack-bearer'], label: 'Slack workspace', actorIds: ['ACTR01b'] }],
    credentials: [{ groupKey: 'apiKey||secret', key: 'apiKey', source: 'secret', actorIds: ['ACTR01a', 'ACTR01b'] }],
    inputs: [
      { key: 'channel', label: 'Slack channel', type: 'string', required: true, default: '#general', targets: [{ actorId: 'ACTR01b', path: 'configuration.inputs.channel' }] },
      { key: 'limit', label: 'Limit', type: 'number', required: true, targets: [{ actorId: 'ACTR01a', path: 'configuration.options.limit' }] },
    ],
  },
};

const makeClient = () => ({
  listRecipes: vi.fn().mockResolvedValue({ total: 2, data: [segment, mcpServer] }),
  getRecipe: vi.fn().mockResolvedValue(segmentDetail),
  listRecipeApps: vi.fn().mockResolvedValue({ total: 1, data: [{ id: 'TAPP01b', name: 'Slack', color: '#000' }] }),
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
  it('upper-cases kinds, passes them and the app id through, and flattens apps and settings for the table', async () => {
    await recipesList({ kind: ['segment', 'FLOW'], appId: 'TAPP01a' }, command);
    expect(client.listRecipes).toHaveBeenCalledWith('test-org', 'test-workspace', expect.objectContaining({ kinds: ['SEGMENT', 'FLOW'], appId: 'TAPP01a' }));
    const [result] = mocks.output.mock.calls[0];
    expect(result.data[0]).toMatchObject({ appNames: 'BorgIQ Utils, Slack', setup: '1 conn / 0 cred / 3 inputs' });
  });

  it('sends an unknown kind to the API and renders its 400', async () => {
    client.listRecipes.mockRejectedValue(new ApiError(400, 'Validation failed', [{ path: ['query', 'kinds', 0], message: 'Invalid option: expected one of "FLOW"|"SEGMENT"|"TASK"|"TRIGGER"' }]));
    await expect(recipesList({ kind: ['pipeline'] }, command)).rejects.toThrow('exit:2');
    expect(client.listRecipes).toHaveBeenCalledWith('test-org', 'test-workspace', expect.objectContaining({ kinds: ['PIPELINE'] }));
    const printed = JSON.parse(String(stderr.mock.calls[0]?.[0]));
    expect(printed.error).toMatchObject({ status: 400, message: 'Validation failed', details: [{ path: ['query', 'kinds', 0] }] });
  });

  it('passes --[no-]has-entry and --[no-]has-exit through, and leaves them out when not given', async () => {
    await recipesList({ hasEntry: true, hasExit: false }, command);
    expect(client.listRecipes).toHaveBeenLastCalledWith('test-org', 'test-workspace', expect.objectContaining({ hasEntry: true, hasExit: false }));
    await recipesList({}, command);
    expect(client.listRecipes.mock.lastCall?.[2]).toMatchObject({ hasEntry: undefined, hasExit: undefined, kinds: undefined });
  });

  it('shows the wiring and keeps entry and exit as the API sent them, null included', async () => {
    await recipesList({}, command);
    const [result] = mocks.output.mock.calls[0];
    expect(result.data[0]).toMatchObject({ wiring: 'in→out', entry: { actorId: 'ACTR01a' }, exit: { actorId: 'ACTR01b', portId: 'SPRTdefault' } });
    expect(result.data[1]).toMatchObject({ wiring: '—', entry: null, exit: null });
  });

  it('names each wiring shape', () => {
    expect(wiringOf({ entry: { actorId: 'ACTR01a' }, exit: { actorId: 'ACTR01b', portId: 'SPRTdefault' } })).toBe('in→out');
    expect(wiringOf({ entry: { actorId: 'ACTR01a' }, exit: null })).toBe('in');
    expect(wiringOf({ entry: null, exit: { actorId: 'ACTR01b', portId: 'SPRTdefault' } })).toBe('out');
    expect(wiringOf({ entry: null, exit: null })).toBe('—');
  });
});

describe('client.listRecipes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends kinds as an array and the entry/exit filters as true/false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 0, recipes: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new BorgIQClient('https://api.test', 'token').listRecipes('o', 'w', { kinds: ['PIPELINE'], hasEntry: false, hasExit: true });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.getAll('kinds[]')).toEqual(['PIPELINE']);
    expect(url.searchParams.get('hasEntry')).toBe('false');
    expect(url.searchParams.get('hasExit')).toBe('true');
  });

  it('leaves the entry/exit filters out when unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 0, recipes: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new BorgIQClient('https://api.test', 'token').listRecipes('o', 'w', {});
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.has('hasEntry')).toBe(false);
    expect(url.searchParams.has('hasExit')).toBe(false);
  });
});

describe('recipes get / apps', () => {
  it('outputs the full recipe, groupKeys included, and no summary with --json', async () => {
    await recipesGet('RCPE01hrsqaqq69wq4fwd1qzzebd1a', {}, command);
    expect(client.getRecipe).toHaveBeenCalledWith('test-org', 'test-workspace', 'RCPE01hrsqaqq69wq4fwd1qzzebd1a');
    expect(mocks.output.mock.calls[0][0]).toMatchObject({
      entry: { actorId: 'ACTR01a' },
      settings: { connections: [{ groupKey: 'slack-bearer|slack-oauth2' }], credentials: [{ groupKey: 'apiKey||secret' }] },
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it('summarises the wiring and the --settings keys on a terminal', async () => {
    const isTTY = process.stderr.isTTY;
    process.stderr.isTTY = true;
    try {
      await recipesGet('RCPE01hrsqaqq69wq4fwd1qzzebd1a', {}, { parent: { parent: { opts: () => ({}) } } });
    } finally {
      process.stderr.isTTY = isTTY;
    }
    const printed = String(stderr.mock.calls[0]?.[0]);
    expect(printed).toContain('entry ACTR01a, exit ACTR01b:SPRTdefault');
    expect(printed).toContain('slack-bearer|slack-oauth2  Slack workspace, 1 actor');
    expect(printed).toContain('apiKey||secret  secret, 2 actors');
    expect(printed).toContain('channel  Slack channel (string, required, default "#general")');
    expect(printed).toContain('limit  Limit (number, required)');
  });

  it('describes a recipe with no entry, no exit and no settings', () => {
    const lines = describeRecipe({ ...mcpServer, data: { schemaVersion: '1', actors: {} }, settings: { connections: [], credentials: [], inputs: [] } });
    expect(lines).toEqual(['MCP server (TRIGGER): no entry, no exit', 'Settings: none']);
  });

  it('lists the apps that hold recipes', async () => {
    await recipesApps({}, command);
    expect(client.listRecipeApps).toHaveBeenCalled();
    expect(mocks.output.mock.calls[0][0].data[0].name).toBe('Slack');
  });
});

describe('recipes add', () => {
  it('parses --after with and without a port, sending no portId when none is named', () => {
    expect(parseAfter('ACTR01a')).toEqual({ actorId: 'ACTR01a' });
    expect(parseAfter('ACTR01a')).not.toHaveProperty('portId');
    expect(parseAfter('ACTR01a:SPRTdone000')).toEqual({ actorId: 'ACTR01a', portId: 'SPRTdone000' });
    expect(() => parseAfter('a:b:c')).toThrow(CliUsageError);
    expect(() => parseAfter('ACTR01a:')).toThrow(CliUsageError);
    expect(() => parseAfter(':SPRTdone000')).toThrow(CliUsageError);
  });

  it('builds the body from the flags and reads settings from a file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'recipes-add-'));
    try {
      const file = path.join(dir, 'settings.yaml');
      writeFileSync(file, 'connections:\n  slack-bearer|slack-oauth2: team-slack\ninputs:\n  channel: "#triage"\n');
      const body = await buildInstantiateBody({ canvas: 'c', x: 10, y: 20, after: 'ACTR01a', settings: file });
      expect(body).toEqual({
        position: { x: 10, y: 20 },
        source: { actorId: 'ACTR01a' },
        settings: { connections: { 'slack-bearer|slack-oauth2': 'team-slack' }, inputs: { channel: '#triage' } },
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

  it('refuses --after with --into-edge as a usage error before calling the API', async () => {
    await expect(recipesAdd('RCPE01hrsqaqq69wq4fwd1qzzebd1a', { canvas: 'my-canvas', after: 'ACTR01a', intoEdge: 'EDGE01a' }, command)).rejects.toThrow('exit:2');
    expect(client.instantiateRecipe).not.toHaveBeenCalled();
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0])).error).toMatchObject({ code: 'usage', status: null });
  });

  it('calls the instantiate endpoint and outputs the new actor ids', async () => {
    await recipesAdd('RCPE01hrsqaqq69wq4fwd1qzzebd1a', { canvas: 'my-canvas', intoEdge: 'EDGE01a' }, command);
    expect(client.instantiateRecipe).toHaveBeenCalledWith('test-org', 'test-workspace', 'my-canvas', 'RCPE01hrsqaqq69wq4fwd1qzzebd1a', { edgeId: 'EDGE01a' });
    expect(mocks.output.mock.calls[0][0]).toMatchObject({ actorIds: ['ACTR01x', 'ACTR01y'], edgeIds: ['EDGE01z'] });
  });

  it('sends --after without a port as a bare actor id and outputs null entry/exit ids as they come', async () => {
    client.instantiateRecipe.mockResolvedValue({ actorIds: ['ACTR01x'], entryActorId: null, exitActorId: null, edgeIds: [] });
    await recipesAdd('RCPE01mcp', { canvas: 'my-canvas', after: 'ACTR01a' }, command);
    expect(client.instantiateRecipe).toHaveBeenCalledWith('test-org', 'test-workspace', 'my-canvas', 'RCPE01mcp', { source: { actorId: 'ACTR01a' } });
    expect(mocks.output.mock.calls[0][0]).toEqual({ actorIds: ['ACTR01x'], entryActorId: null, exitActorId: null, edgeIds: [] });
  });

  it('renders the API\'s 400 when the recipe does not fit the wiring', async () => {
    client.instantiateRecipe.mockRejectedValue(new ApiError(400, 'Validation failed', [{ path: ['source'], message: 'a TRIGGER recipe starts a flow; it cannot be wired in after an actor' }]));
    await expect(recipesAdd('RCPE01mcp', { canvas: 'my-canvas', after: 'ACTR01a' }, command)).rejects.toThrow('exit:2');
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0])).error.details).toEqual([{ path: ['source'], message: 'a TRIGGER recipe starts a flow; it cannot be wired in after an actor' }]);
  });
});
