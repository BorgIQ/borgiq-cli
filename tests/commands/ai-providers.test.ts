import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientWithContext: vi.fn(),
  output: vi.fn(),
  confirmDestructive: vi.fn(),
}));

vi.mock('../../src/lib/context.js', () => ({
  createClientWithContext: mocks.createClientWithContext,
}));

vi.mock('../../src/output/index.js', () => ({
  output: mocks.output,
}));

vi.mock('../../src/lib/prompt.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/prompt.js')>()),
  confirmDestructive: mocks.confirmDestructive,
}));

import { aiProvidersCreate } from '../../src/commands/ai-providers/create.js';
import { aiProvidersEdit } from '../../src/commands/ai-providers/edit.js';
import { aiProvidersDelete } from '../../src/commands/ai-providers/delete.js';
import { aiProvidersList } from '../../src/commands/ai-providers/list.js';
import { aiProvidersModels } from '../../src/commands/ai-providers/models.js';
import { mergeCatalog, parseCatalogFlags, splitIds } from '../../src/commands/ai-providers/shared.js';
import { CliUsageError } from '../../src/lib/errors.js';
import type { BIQAiSettingMetadata } from '../../src/client/types.js';

const command = { parent: { parent: { opts: () => ({ json: true }) } } };

const fireworks: BIQAiSettingMetadata = {
  id: 'AIST01', name: 'fireworks', provider: 'custom', connectionId: 'CONN01',
  data: { models: [{ id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 70B' }], baseURL: undefined },
  createdAt: '2026-09-14T00:00:00.000Z', updatedAt: null,
};
const openai: BIQAiSettingMetadata = {
  id: 'AIST02', name: 'openai', provider: 'openai', connectionId: 'CONN02', data: {},
  createdAt: '2026-09-14T00:00:00.000Z', updatedAt: null,
};

const makeClient = () => ({
  listAiSettings: vi.fn().mockResolvedValue([fireworks, openai]),
  createAiSettingMultipart: vi.fn().mockImplementation(async (_o: string, _w: string, form: FormData) => ({ id: 'AIST03', name: form.get('name'), provider: form.get('provider') })),
  updateAiSettingMultipart: vi.fn().mockImplementation(async (_o: string, _w: string, id: string, form: FormData) => ({ id, name: form.get('name') ?? 'fireworks', provider: 'custom' })),
  deleteAiSetting: vi.fn().mockResolvedValue(undefined),
  listAiModels: vi.fn().mockResolvedValue({ models: [
    { ref: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai', group: 'OpenAI', custom: false },
    { ref: 'fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 70B', provider: 'fireworks', group: 'Custom Provider — fireworks', custom: true },
  ] }),
  listConnections: vi.fn().mockResolvedValue({ total: 1, data: [{ id: 'CONN09', key: 'groq-key', type: 'custom-provider-apikey', description: '', createdAt: '' }] }),
});

let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;
const originalIsTTY = process.stdin.isTTY;

beforeEach(() => {
  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
  mocks.confirmDestructive.mockReset().mockResolvedValue(undefined);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

afterEach(() => {
  stderr.mockRestore();
  exit.mockRestore();
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  vi.clearAllMocks();
});

const lastStderr = (): string => stderr.mock.calls.map((c) => String(c[0])).join('');

describe('shared helpers', () => {
  it('splitIds flattens repeatable and comma-separated values', () => {
    expect(splitIds(['a,b', ' c '])).toEqual(['a', 'b', 'c']);
    expect(splitIds('x')).toEqual(['x']);
    expect(splitIds(undefined)).toEqual([]);
  });

  it('mergeCatalog replaces, adds without duplicating and removes, keeping other entries intact', () => {
    const current = [{ id: 'a', label: 'A' }, { id: 'b' }];
    expect(mergeCatalog(current, { add: ['b', 'c'] })).toEqual([{ id: 'a', label: 'A' }, { id: 'b' }, { id: 'c' }]);
    expect(mergeCatalog(current, { remove: ['a'] })).toEqual([{ id: 'b' }]);
    expect(mergeCatalog(current, { replace: [{ id: 'z' }], add: ['y'] })).toEqual([{ id: 'z' }, { id: 'y' }]);
  });

  it('parseCatalogFlags reads comma-separated ids and refuses both flags at once', async () => {
    expect(await parseCatalogFlags({ models: 'a, b' })).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(await parseCatalogFlags({})).toBeUndefined();
    await expect(parseCatalogFlags({ models: 'a', modelsFile: 'x.json' })).rejects.toThrow(CliUsageError);
  });
});

describe('ai-providers create', () => {
  it('posts multipart fields with the catalog and resolves a connection key to its id', async () => {
    await aiProvidersCreate({ provider: 'custom', name: 'groq', connection: 'groq-key', models: 'llama-3.3-70b-versatile,mixtral' }, command);
    const form = client.createAiSettingMultipart.mock.calls[0][2] as FormData;
    expect(form.get('name')).toBe('groq');
    expect(form.get('provider')).toBe('custom');
    expect(form.get('connectionId')).toBe('CONN09');
    expect(JSON.parse(String(form.get('data')))).toEqual({ models: [{ id: 'llama-3.3-70b-versatile' }, { id: 'mixtral' }] });
    expect(client.listConnections).toHaveBeenCalledWith('test-org', 'test-workspace', { search: 'groq-key', pageSize: 20 });
    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({ id: 'AIST03', name: 'groq' }), expect.anything());
  });

  it('passes an unknown connection value through as an id and defaults the name to the provider', async () => {
    client.listConnections.mockResolvedValue({ total: 0, data: [] });
    await aiProvidersCreate({ provider: 'openai', connection: 'CONN77' }, command);
    const form = client.createAiSettingMultipart.mock.calls[0][2] as FormData;
    expect(form.get('name')).toBe('openai');
    expect(form.get('connectionId')).toBe('CONN77');
    expect(JSON.parse(String(form.get('data')))).toEqual({});
  });

  it('stores --base-url as the data.baseURL override alongside the catalog, normalized', async () => {
    await aiProvidersCreate({ provider: 'custom', name: 'groq', connection: 'CONN09', baseUrl: ' https://gateway.example/groq/v1/ ', models: 'llama' }, command);
    const form = client.createAiSettingMultipart.mock.calls[0][2] as FormData;
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: 'https://gateway.example/groq/v1', models: [{ id: 'llama' }] });
  });

  it('rejects a --base-url that is not an absolute http(s) URL', async () => {
    await aiProvidersCreate({ provider: 'custom', name: 'groq', baseUrl: 'api.groq.com/openai/v1' }, command);
    expect(client.createAiSettingMultipart).not.toHaveBeenCalled();
    expect(lastStderr()).toMatch(/--base-url must be an absolute http/);
  });

  it('fails with a usage error when --provider is missing and not interactive', async () => {
    await aiProvidersCreate({}, command);
    expect(client.createAiSettingMultipart).not.toHaveBeenCalled();
    expect(lastStderr()).toMatch(/--provider is required/);
  });
});

describe('ai-providers edit', () => {
  it('resolves by name, resends the current connection and merges catalog additions and removals', async () => {
    await aiProvidersEdit('fireworks', { addModel: ['accounts/fireworks/models/qwen'], removeModel: ['accounts/fireworks/models/llama-v3p1-70b-instruct'] }, command);
    expect(client.updateAiSettingMultipart).toHaveBeenCalledWith('test-org', 'test-workspace', 'AIST01', expect.any(FormData));
    const form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(form.get('connectionId')).toBe('CONN01');
    expect(form.get('name')).toBeNull();
    expect(JSON.parse(String(form.get('data')))).toEqual({ models: [{ id: 'accounts/fireworks/models/qwen' }] });
  });

  it('renames, replaces the catalog and clears the connection with --no-connection', async () => {
    await aiProvidersEdit('AIST01', { name: 'fireworks-eu', connection: false, models: 'a' }, command);
    const form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(form.get('name')).toBe('fireworks-eu');
    expect(form.get('connectionId')).toBe('');
    expect(JSON.parse(String(form.get('data')))).toEqual({ models: [{ id: 'a' }] });
  });

  it('sets the base URL override and keeps the catalog, and --no-base-url clears it', async () => {
    await aiProvidersEdit('fireworks', { baseUrl: 'https://gateway.example/fw/v1' }, command);
    let form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: 'https://gateway.example/fw/v1', models: [{ id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 70B' }] });
    await aiProvidersEdit('fireworks', { baseUrl: false }, command);
    form = client.updateAiSettingMultipart.mock.calls[1][3] as FormData;
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: '', models: [{ id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 70B' }] });
  });

  it('refuses --data-file together with --base-url', async () => {
    await aiProvidersEdit('fireworks', { dataFile: 'x.json', baseUrl: 'https://x/v1' }, command);
    expect(client.updateAiSettingMultipart).not.toHaveBeenCalled();
    expect(lastStderr()).toMatch(/--data-file replaces the whole data object/);
  });

  it('reports an unknown provider', async () => {
    await aiProvidersEdit('nope', { models: 'a' }, command);
    expect(client.updateAiSettingMultipart).not.toHaveBeenCalled();
    expect(lastStderr()).toMatch(/AI provider 'nope' not found/);
  });
});

describe('ai-providers delete', () => {
  it('confirms, then deletes by the resolved id', async () => {
    await aiProvidersDelete('fireworks', {}, command);
    expect(mocks.confirmDestructive).toHaveBeenCalled();
    expect(client.deleteAiSetting).toHaveBeenCalledWith('test-org', 'test-workspace', 'AIST01');
  });
});

describe('ai-providers list and models', () => {
  it('lists settings with a model count and filters by provider', async () => {
    await aiProvidersList({ provider: 'custom' }, command);
    const rows = mocks.output.mock.calls[0][0] as { name: string; models: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'fireworks', models: 1 });
  });

  it('lists usable model references, optionally only custom ones', async () => {
    await aiProvidersModels({ custom: true }, command);
    const rows = mocks.output.mock.calls[0][0] as { ref: string }[];
    expect(rows.map((r) => r.ref)).toEqual(['fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct']);
    await aiProvidersModels({}, command);
    expect((mocks.output.mock.calls[1][0] as unknown[]).length).toBe(2);
  });
});
