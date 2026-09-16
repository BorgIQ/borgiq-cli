import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientWithContext: vi.fn(),
  output: vi.fn(),
  realOutput: undefined as undefined | ((...args: unknown[]) => void),
  confirmDestructive: vi.fn(),
}));

vi.mock('../../src/lib/context.js', () => ({
  createClientWithContext: mocks.createClientWithContext,
}));

vi.mock('../../src/output/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/output/index.js')>();
  mocks.realOutput = real.output as (...args: unknown[]) => void;
  return { output: mocks.output };
});

vi.mock('../../src/lib/prompt.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/prompt.js')>()),
  confirmDestructive: mocks.confirmDestructive,
}));

import { aiProvidersCreate } from '../../src/commands/ai-providers/create.js';
import { aiProvidersEdit } from '../../src/commands/ai-providers/edit.js';
import { aiProvidersDelete } from '../../src/commands/ai-providers/delete.js';
import { aiProvidersList } from '../../src/commands/ai-providers/list.js';
import { aiProvidersModels } from '../../src/commands/ai-providers/models.js';
import { flagsGiven, mergeCatalog, parseCatalogFlags, splitIds } from '../../src/commands/ai-providers/shared.js';
import { readInput } from '../../src/lib/input.js';
import { CliUsageError } from '../../src/lib/errors.js';
import { ApiError } from '../../src/client/errors.js';
import type { BIQAiSettingMetadata } from '../../src/client/types.js';

const command = { parent: { parent: { opts: () => ({ json: true }) } } };
const tableCommand = { parent: { parent: { opts: () => ({ json: false }) } } };

const llama = { id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 70B' };
const fireworks: BIQAiSettingMetadata = {
  id: 'AIST01', name: 'fireworks', provider: 'custom', connectionId: 'CONN01',
  data: { baseURL: 'https://gateway.example/fw/v1', models: [llama] },
  effectiveBaseUrl: 'https://gateway.example/fw/v1', baseUrlSource: 'setting',
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
  getAiSettingReferences: vi.fn().mockResolvedValue({ count: 0, canvases: [] }),
  listAiModels: vi.fn().mockResolvedValue({ models: [
    { ref: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai', group: 'OpenAI', custom: false, agent: true },
    { ref: 'fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 70B', provider: 'fireworks', group: 'Custom Provider — fireworks', custom: true, agent: false },
  ] }),
  getConnection: vi.fn().mockResolvedValue({ id: 'CONN09', key: 'groq-key', type: 'custom-provider-apikey', description: '', createdAt: '' }),
});

let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;
const originalIsTTY = process.stdin.isTTY;
const originalArgv = process.argv;

beforeEach(() => {
  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
  mocks.confirmDestructive.mockReset().mockResolvedValue(undefined);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // handleError exits with a category code; the throwing stub lets tests assert on it.
  exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code}`);
  }) as never);
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  process.argv = ['node', 'borgiq'];
});

afterEach(() => {
  stderr.mockRestore();
  exit.mockRestore();
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  process.argv = originalArgv;
  vi.clearAllMocks();
});

const allStderr = (): string => stderr.mock.calls.map((c) => String(c[0])).join('');

/** Write fixtures into a scratch directory that is removed after the test. */
const withTempDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-providers-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

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

  it('parseCatalogFlags accepts an array, a { models } object and string entries from --models-file', async () => {
    await withTempDir(async (dir) => {
      const asArray = path.join(dir, 'array.json');
      writeFileSync(asArray, JSON.stringify([{ id: 'a', label: 'A', agent: false }, 'b']));
      expect(await parseCatalogFlags({ modelsFile: asArray })).toEqual([{ id: 'a', label: 'A', agent: false }, { id: 'b' }]);

      const wrapped = path.join(dir, 'wrapped.yaml');
      writeFileSync(wrapped, 'models:\n  - id: c\n  - d\n');
      expect(await parseCatalogFlags({ modelsFile: wrapped })).toEqual([{ id: 'c' }, { id: 'd' }]);
    });
  });

  it('parseCatalogFlags rejects an entry without an id and a file that is not a list', async () => {
    await withTempDir(async (dir) => {
      const noId = path.join(dir, 'no-id.json');
      writeFileSync(noId, JSON.stringify([{ label: 'nameless' }]));
      await expect(parseCatalogFlags({ modelsFile: noId })).rejects.toThrow(/needs an "id"/);

      const notList = path.join(dir, 'not-list.json');
      writeFileSync(notList, JSON.stringify({ id: 'a' }));
      await expect(parseCatalogFlags({ modelsFile: notList })).rejects.toThrow(/array of model entries/);
    });
  });

  it('readInput reports a missing or malformed file as a usage error instead of exiting', async () => {
    await expect(readInput('/nonexistent/models.json')).rejects.toThrow(new CliUsageError('File not found: /nonexistent/models.json'));
    await withTempDir(async (dir) => {
      const broken = path.join(dir, 'broken.json');
      writeFileSync(broken, '{ not json');
      await expect(readInput(broken)).rejects.toThrow(/Invalid JSON in file/);
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it('flagsGiven sees both spellings of a long flag and stops at --', () => {
    process.argv = ['node', 'borgiq', 'ai-providers', 'edit', 'fw', '--base-url=https://x/v1', '--no-base-url'];
    expect(flagsGiven('--base-url', '--no-base-url')).toBe(true);
    process.argv = ['node', 'borgiq', 'ai-providers', 'edit', 'fw', '--no-base-url', '--', '--base-url'];
    expect(flagsGiven('--base-url', '--no-base-url')).toBe(false);
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
    expect(client.getConnection).toHaveBeenCalledWith('test-org', 'test-workspace', 'groq-key');
    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({ id: 'AIST03', name: 'groq' }), expect.anything());
  });

  it('defaults a built-in provider\'s name to the provider id and sends an empty data object', async () => {
    client.getConnection.mockResolvedValue({ id: 'CONN77', key: 'openai-main', type: 'openai-apikey' });
    await aiProvidersCreate({ provider: 'openai', connection: 'CONN77' }, command);
    const form = client.createAiSettingMultipart.mock.calls[0][2] as FormData;
    expect(form.get('name')).toBe('openai');
    expect(form.get('connectionId')).toBe('CONN77');
    expect(JSON.parse(String(form.get('data')))).toEqual({});
  });

  it('fails with the usage code and a hint when the connection key does not exist', async () => {
    client.getConnection.mockRejectedValue(new ApiError(404, 'Connection not found'));
    await expect(aiProvidersCreate({ provider: 'custom', name: 'groq', connection: 'typo-key', models: 'a' }, command)).rejects.toThrow('process.exit:2');
    expect(client.createAiSettingMultipart).not.toHaveBeenCalled();
    expect(allStderr()).toMatch(/Connection 'typo-key' not found\. Run `borgiq connections list`/);
  });

  it('surfaces non-404 connection lookup failures as-is', async () => {
    client.getConnection.mockRejectedValue(new ApiError(403, 'Forbidden'));
    await expect(aiProvidersCreate({ provider: 'custom', name: 'groq', connection: 'groq-key', models: 'a' }, command)).rejects.toThrow('process.exit:4');
    expect(allStderr()).not.toMatch(/not found/);
  });

  it('stores --base-url as the data.baseURL override alongside the catalog, normalized', async () => {
    await aiProvidersCreate({ provider: 'custom', name: 'groq', connection: 'CONN09', baseUrl: ' https://gateway.example/groq/v1/ ', models: 'llama' }, command);
    const form = client.createAiSettingMultipart.mock.calls[0][2] as FormData;
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: 'https://gateway.example/groq/v1', models: [{ id: 'llama' }] });
  });

  it('rejects a --base-url that is not an absolute http(s) URL', async () => {
    await expect(aiProvidersCreate({ provider: 'custom', name: 'groq', baseUrl: 'api.groq.com/openai/v1' }, command)).rejects.toThrow('process.exit:2');
    expect(client.createAiSettingMultipart).not.toHaveBeenCalled();
    expect(allStderr()).toMatch(/--base-url must be an absolute http/);
  });

  it('rejects --base-url and the catalog flags on a built-in provider', async () => {
    await expect(aiProvidersCreate({ provider: 'openai', baseUrl: 'https://x/v1' }, command)).rejects.toThrow('process.exit:2');
    expect(allStderr()).toMatch(/--base-url applies to custom providers only/);
    await expect(aiProvidersCreate({ provider: 'openai', models: 'gpt-4o' }, command)).rejects.toThrow('process.exit:2');
    expect(allStderr()).toMatch(/--models applies to custom providers only/);
    expect(client.createAiSettingMultipart).not.toHaveBeenCalled();
  });

  it('refuses --data-file together with --base-url', async () => {
    await expect(aiProvidersCreate({ provider: 'custom', name: 'groq', dataFile: 'x.json', baseUrl: 'https://x/v1' }, command)).rejects.toThrow('process.exit:2');
    expect(client.createAiSettingMultipart).not.toHaveBeenCalled();
    expect(allStderr()).toMatch(/--data-file replaces the whole data object/);
  });

  it('fails with a usage error when --provider is missing and not interactive', async () => {
    await expect(aiProvidersCreate({}, command)).rejects.toThrow('process.exit:2');
    expect(client.createAiSettingMultipart).not.toHaveBeenCalled();
    expect(allStderr()).toMatch(/--provider is required/);
  });

  it('requires --name for a custom provider when not interactive', async () => {
    await expect(aiProvidersCreate({ provider: 'custom', models: 'a' }, command)).rejects.toThrow('process.exit:2');
    expect(client.createAiSettingMultipart).not.toHaveBeenCalled();
    expect(allStderr()).toMatch(/--name is required for a custom provider/);
  });

  it('warns when a custom provider is created without models non-interactively', async () => {
    await aiProvidersCreate({ provider: 'custom', name: 'groq', connection: 'groq-key' }, command);
    expect(client.createAiSettingMultipart).toHaveBeenCalled();
    expect(allStderr()).toMatch(/Warning: custom provider 'groq' has no models/);
  });

  it('exits with the usage code when the API rejects the setting (422)', async () => {
    client.createAiSettingMultipart.mockRejectedValue(new ApiError(422, 'Validation failed', [{ path: ['name'], message: 'invalid slug' }]));
    await expect(aiProvidersCreate({ provider: 'custom', name: 'Bad Slug', models: 'a' }, command)).rejects.toThrow('process.exit:2');
    expect(allStderr()).toMatch(/Validation failed/);
  });
});

describe('ai-providers edit', () => {
  it('resolves by name, resends the current connection and merges catalog additions and removals, keeping baseURL', async () => {
    await aiProvidersEdit('fireworks', { addModel: ['accounts/fireworks/models/qwen'], removeModel: [llama.id] }, command);
    expect(client.updateAiSettingMultipart).toHaveBeenCalledWith('test-org', 'test-workspace', 'AIST01', expect.any(FormData));
    const form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(form.get('connectionId')).toBe('CONN01');
    expect(form.get('name')).toBeNull();
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: 'https://gateway.example/fw/v1', models: [{ id: 'accounts/fireworks/models/qwen' }] });
  });

  it('--add-model keeps the existing entries (with their labels) and the base URL', async () => {
    await aiProvidersEdit('fireworks', { addModel: ['accounts/fireworks/models/deepseek-v3'] }, command);
    const form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(JSON.parse(String(form.get('data')))).toEqual({
      baseURL: 'https://gateway.example/fw/v1',
      models: [llama, { id: 'accounts/fireworks/models/deepseek-v3' }],
    });
  });

  it('renames, replaces the catalog and clears the connection with --no-connection', async () => {
    await aiProvidersEdit('AIST01', { name: 'fireworks-eu', connection: false, models: 'a' }, command);
    const form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(form.get('name')).toBe('fireworks-eu');
    expect(form.get('connectionId')).toBe('');
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: 'https://gateway.example/fw/v1', models: [{ id: 'a' }] });
  });

  it('a rename alone leaves data untouched and warns about the canvases referencing the provider', async () => {
    client.getAiSettingReferences.mockResolvedValue({ count: 7, canvases: [
      { id: 'C1', name: 'Support triage' }, { id: 'C2', name: 'Lead scoring' }, { id: 'C3', name: 'c3' },
      { id: 'C4', name: 'c4' }, { id: 'C5', name: 'c5' }, { id: 'C6', name: 'c6' }, { id: 'C7', name: 'c7' },
    ] });
    await aiProvidersEdit('fireworks', { name: 'fireworks-eu' }, command);
    const form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(form.get('name')).toBe('fireworks-eu');
    expect(form.get('connectionId')).toBe('CONN01');
    expect(form.get('data')).toBeNull();
    expect(client.getAiSettingReferences).toHaveBeenCalledWith('test-org', 'test-workspace', 'AIST01');
    expect(allStderr()).toMatch(/Warning: 7 canvas\(es\) reference this provider \(Support triage, Lead scoring, c3, c4, c5, \+2 more\) — their "<slug>\/<model-id>" models will stop resolving after the rename\./);
  });

  it('does not warn when the name is unchanged or nothing references the provider', async () => {
    await aiProvidersEdit('fireworks', { name: 'fireworks' }, command);
    expect(client.getAiSettingReferences).not.toHaveBeenCalled();
    await aiProvidersEdit('fireworks', { name: 'fireworks-2' }, command);
    expect(client.getAiSettingReferences).toHaveBeenCalledTimes(1);
    expect(allStderr()).not.toMatch(/Warning/);
  });

  it('tolerates an API without the references route', async () => {
    client.getAiSettingReferences.mockRejectedValue(new ApiError(404, 'Not found'));
    await aiProvidersEdit('fireworks', { name: 'fireworks-eu' }, command);
    expect(client.updateAiSettingMultipart).toHaveBeenCalled();
    expect(allStderr()).not.toMatch(/Warning/);
  });

  it('sets the base URL override and keeps the catalog, and --no-base-url clears it', async () => {
    await aiProvidersEdit('fireworks', { baseUrl: 'https://other.example/fw/v1' }, command);
    let form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: 'https://other.example/fw/v1', models: [llama] });
    await aiProvidersEdit('fireworks', { baseUrl: false }, command);
    form = client.updateAiSettingMultipart.mock.calls[1][3] as FormData;
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: '', models: [llama] });
  });

  it('refuses --base-url together with --no-base-url, and --connection with --no-connection', async () => {
    process.argv = ['node', 'borgiq', 'ai-providers', 'edit', 'fireworks', '--base-url', 'https://x/v1', '--no-base-url'];
    await expect(aiProvidersEdit('fireworks', { baseUrl: false }, command)).rejects.toThrow('process.exit:2');
    expect(allStderr()).toMatch(/either --base-url <url> or --no-base-url/);

    process.argv = ['node', 'borgiq', 'ai-providers', 'edit', 'fireworks', '--no-connection', '--connection=groq-key'];
    await expect(aiProvidersEdit('fireworks', { connection: 'groq-key' }, command)).rejects.toThrow('process.exit:2');
    expect(allStderr()).toMatch(/either --connection <key-or-id> or --no-connection/);
    expect(client.updateAiSettingMultipart).not.toHaveBeenCalled();
  });

  it('refuses --data-file together with --base-url', async () => {
    await expect(aiProvidersEdit('fireworks', { dataFile: 'x.json', baseUrl: 'https://x/v1' }, command)).rejects.toThrow('process.exit:2');
    expect(client.updateAiSettingMultipart).not.toHaveBeenCalled();
    expect(allStderr()).toMatch(/--data-file replaces the whole data object/);
  });

  it('warns that --data-file replaces an existing catalog', async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, 'data.json');
      writeFileSync(file, JSON.stringify({ baseURL: 'https://x/v1' }));
      await aiProvidersEdit('fireworks', { dataFile: file }, command);
    });
    const form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(JSON.parse(String(form.get('data')))).toEqual({ baseURL: 'https://x/v1' });
    expect(allStderr()).toMatch(/Warning: --data-file replaces the whole data object; the current catalog of 1 model\(s\)/);
  });

  it('rejects the base URL and catalog flags on a built-in provider', async () => {
    await expect(aiProvidersEdit('openai', { baseUrl: 'https://x/v1' }, command)).rejects.toThrow('process.exit:2');
    expect(allStderr()).toMatch(/--base-url applies to custom providers only/);
    await expect(aiProvidersEdit('openai', { baseUrl: false }, command)).rejects.toThrow('process.exit:2');
    expect(allStderr()).toMatch(/--no-base-url applies to custom providers only/);
    await expect(aiProvidersEdit('openai', { addModel: ['gpt-4o'] }, command)).rejects.toThrow('process.exit:2');
    expect(allStderr()).toMatch(/--add-model applies to custom providers only/);
    expect(client.updateAiSettingMultipart).not.toHaveBeenCalled();
  });

  it('still allows re-linking a built-in provider', async () => {
    await aiProvidersEdit('openai', { connection: 'groq-key' }, command);
    const form = client.updateAiSettingMultipart.mock.calls[0][3] as FormData;
    expect(form.get('connectionId')).toBe('CONN09');
  });

  it('does nothing when no flag is given', async () => {
    await aiProvidersEdit('fireworks', {}, command);
    expect(client.updateAiSettingMultipart).not.toHaveBeenCalled();
    expect(mocks.output).not.toHaveBeenCalled();
    expect(allStderr()).toBe('Nothing to update.\n');
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits with the not-found code for an unknown provider', async () => {
    await expect(aiProvidersEdit('nope', { models: 'a' }, command)).rejects.toThrow('process.exit:5');
    expect(client.updateAiSettingMultipart).not.toHaveBeenCalled();
    expect(allStderr()).toMatch(/AI provider 'nope' not found/);
    expect(allStderr()).toMatch(/not_found/);
  });
});

describe('ai-providers delete', () => {
  it('confirms, then deletes by the resolved id', async () => {
    await aiProvidersDelete('fireworks', {}, command);
    expect(mocks.confirmDestructive).toHaveBeenCalledWith(expect.stringContaining('fireworks (AIST01)'), {});
    expect(client.deleteAiSetting).toHaveBeenCalledWith('test-org', 'test-workspace', 'AIST01');
  });

  it('forwards --yes to the confirmation', async () => {
    await aiProvidersDelete('AIST01', { yes: true }, command);
    expect(mocks.confirmDestructive).toHaveBeenCalledWith(expect.any(String), { yes: true });
    expect(client.deleteAiSetting).toHaveBeenCalled();
  });

  it('does not delete when the confirmation is declined', async () => {
    // The real confirmDestructive ends the process with exit(0); the throwing stub cannot stop the
    // handler the same way, so only the absence of the delete call is asserted.
    mocks.confirmDestructive.mockImplementation(async () => { process.exit(0); });
    await expect(aiProvidersDelete('fireworks', {}, command)).rejects.toThrow(/process\.exit:/);
    expect(exit).toHaveBeenCalledWith(0);
    expect(client.deleteAiSetting).not.toHaveBeenCalled();
  });

  it('warns about the referencing canvases before asking for confirmation', async () => {
    const order: string[] = [];
    client.getAiSettingReferences.mockImplementation(async () => { order.push('references'); return { count: 2, canvases: [{ id: 'C1', name: 'Support triage' }, { id: 'C2', name: 'Lead scoring' }] }; });
    mocks.confirmDestructive.mockImplementation(async () => { order.push('confirm'); });
    await aiProvidersDelete('fireworks', {}, command);
    expect(order).toEqual(['references', 'confirm']);
    expect(allStderr()).toMatch(/Warning: 2 canvas\(es\) reference this provider \(Support triage, Lead scoring\) — their "<slug>\/<model-id>" models will stop resolving after the delete\./);
  });

  it('exits with the not-found code for an unknown provider', async () => {
    await expect(aiProvidersDelete('nope', { yes: true }, command)).rejects.toThrow('process.exit:5');
    expect(client.deleteAiSetting).not.toHaveBeenCalled();
    expect(allStderr()).toMatch(/AI provider 'nope' not found/);
  });

  it('exits with the not-found code when the API no longer has the provider', async () => {
    client.deleteAiSetting.mockRejectedValue(new ApiError(404, 'AI setting not found'));
    await expect(aiProvidersDelete('fireworks', { yes: true }, command)).rejects.toThrow('process.exit:5');
    expect(allStderr()).toMatch(/AI setting not found/);
  });
});

describe('ai-providers list and models', () => {
  it('lists settings with modelCount and the effective base URL, filtered by provider', async () => {
    await aiProvidersList({ provider: 'custom' }, command);
    const [rows, , config] = mocks.output.mock.calls[0] as [{ name: string; modelCount: number; effectiveBaseUrl?: string }[], unknown, { columns: { key: string; header: string }[] }];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'fireworks', modelCount: 1, effectiveBaseUrl: 'https://gateway.example/fw/v1' });
    expect(rows[0]).not.toHaveProperty('models');
    expect(config.columns).toEqual(expect.arrayContaining([
      { key: 'effectiveBaseUrl', header: 'BASE URL' },
      { key: 'modelCount', header: 'MODELS' },
    ]));
  });

  it('lists nothing without failing when the workspace has no providers or models', async () => {
    client.listAiSettings.mockResolvedValue([]);
    client.listAiModels.mockResolvedValue({ models: [] });
    await aiProvidersList({}, command);
    await aiProvidersModels({}, command);
    expect(mocks.output.mock.calls[0][0]).toEqual([]);
    expect(mocks.output.mock.calls[1][0]).toEqual([]);
    expect(exit).not.toHaveBeenCalled();
    expect(allStderr()).toBe('');
  });

  it('renders a table with the BASE URL and MODELS columns on a terminal', async () => {
    mocks.output.mockImplementation(mocks.realOutput!);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stdoutTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    let printed = '';
    try {
      await aiProvidersList({}, tableCommand);
      printed = stdout.mock.calls.map((c) => String(c[0])).join('');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: stdoutTTY, configurable: true });
      stdout.mockRestore();
    }
    expect(printed).toMatch(/AI providers/);
    expect(printed).toMatch(/ID\s+NAME\s+PROVIDER\s+CONNECTION\s+BASE URL\s+MODELS\s+UPDATED/);
    expect(printed).toMatch(/fireworks\s+custom\s+CONN01\s+https:\/\/gateway\.example\/fw\/v1\s+1/);
  });

  it('lists usable model references with the agent flag, optionally only custom ones', async () => {
    await aiProvidersModels({ custom: true }, command);
    const [rows, , config] = mocks.output.mock.calls[0] as [{ ref: string; agent: boolean }[], unknown, { columns: { key: string; header: string }[] }];
    expect(rows.map((r) => r.ref)).toEqual(['fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct']);
    expect(rows[0].agent).toBe(false);
    expect(config.columns).toContainEqual({ key: 'agent', header: 'AGENT' });
    await aiProvidersModels({}, command);
    expect((mocks.output.mock.calls[1][0] as unknown[]).length).toBe(2);
  });

  it('filters by provider and hints when no provider has that name', async () => {
    await aiProvidersModels({ provider: 'fireworks' }, command);
    expect((mocks.output.mock.calls[0][0] as { ref: string }[]).map((r) => r.ref)).toEqual(['fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct']);
    expect(allStderr()).toBe('');

    await aiProvidersModels({ provider: 'firework' }, command);
    expect(mocks.output.mock.calls[1][0]).toEqual([]);
    expect(allStderr()).toMatch(/No provider named 'firework'\. Run `borgiq ai-providers list`/);
    expect(exit).not.toHaveBeenCalled();
  });
});
