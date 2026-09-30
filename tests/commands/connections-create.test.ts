import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientWithContext: vi.fn(),
  output: vi.fn(),
  encryptWorkspaceData: vi.fn(),
}));

vi.mock('../../src/lib/context.js', () => ({
  createClientWithContext: mocks.createClientWithContext,
}));

vi.mock('../../src/output/index.js', () => ({ output: mocks.output }));

vi.mock('../../src/lib/crypto.js', () => ({
  getWorkspacePublicKey: vi.fn().mockResolvedValue({}),
  encryptWorkspaceData: mocks.encryptWorkspaceData,
}));

import { buildConnectionSecretData, connectionsCreate } from '../../src/commands/connections/create.js';

const command = { parent: { parent: { opts: () => ({ json: true }) } } };

const awsFormData = {
  authType: 'awsKeyBased',
  hasBorgIQManagedOptions: false,
  inputsJsonSchema: { properties: { awsRegion: { type: 'string' } } },
  secretInputsJsonSchema: { properties: { accessKey: { type: 'string' }, secretKey: { type: 'string' } } },
};

let dir: string;
let client: { getConnectionFormData: ReturnType<typeof vi.fn>; createConnectionMultipart: ReturnType<typeof vi.fn> };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'connections-create-'));
  client = {
    getConnectionFormData: vi.fn().mockResolvedValue(awsFormData),
    createConnectionMultipart: vi.fn().mockResolvedValue({ id: 'CONN01', key: 'my-aws' }),
  };
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
  mocks.encryptWorkspaceData.mockReset().mockResolvedValue({
    encryptedData: new Uint8Array([1]),
    encryptedSymmetricKey: new Uint8Array([2]),
    iv: new Uint8Array([3]),
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeJson = (name: string, value: unknown): string => {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(value));
  return file;
};

describe('connections create', () => {
  it('encrypts the secret inputs under `inputs`, where connection templates read them, as the web app does', async () => {
    await connectionsCreate({
      key: 'my-aws',
      type: 'aws-key-based',
      inputsFile: writeJson('inputs.json', { awsRegion: 'us-east-1' }),
      secretInputsFile: writeJson('secret.json', { accessKey: 'AKIAEXAMPLE', secretKey: 'secret/key' }),
    }, command);

    expect(mocks.encryptWorkspaceData).toHaveBeenCalledOnce();
    const plaintext = mocks.encryptWorkspaceData.mock.calls[0][1] as string;
    expect(JSON.parse(plaintext)).toEqual({ inputs: { accessKey: 'AKIAEXAMPLE', secretKey: 'secret/key' } });

    const form = client.createConnectionMultipart.mock.calls[0][2] as FormData;
    // the public half carries only the non-secret inputs
    expect(JSON.parse(form.get('data') as string)).toEqual({ inputs: { awsRegion: 'us-east-1' } });
    expect(mocks.output).toHaveBeenCalledWith({ id: 'CONN01', key: 'my-aws' }, { json: true });
  });
});

describe('buildConnectionSecretData', () => {
  it('omits empty user-managed options', () => {
    expect(buildConnectionSecretData({ apiKey: 'k' }, {})).toEqual({ inputs: { apiKey: 'k' } });
  });

  it('keeps user-managed options when there are any', () => {
    expect(buildConnectionSecretData({}, { clientId: 'id' })).toEqual({ inputs: {}, userManagedOptionsInputs: { clientId: 'id' } });
  });
});
