import { Command, CommanderError } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientWithContext: vi.fn(),
  output: vi.fn(),
}));

vi.mock('../../src/lib/context.js', () => ({
  createClientWithContext: mocks.createClientWithContext,
}));

vi.mock('../../src/output/index.js', () => ({ output: mocks.output }));

import { flowrunResultsData } from '../../src/commands/flowrun-results/data.js';
import { registerFlowrunResultsCommands } from '../../src/commands/flowrun-results/index.js';

const RESULT_ID = 'FRJR01result0000000000000000';
const command = { parent: { parent: { opts: () => ({ json: true }) } } };

let client: { getJobResultData: ReturnType<typeof vi.fn> };

beforeEach(() => {
  client = { getJobResultData: vi.fn().mockResolvedValue({ default: [{ ok: true }] }) };
  mocks.createClientWithContext.mockReset().mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
});

/** Parses `flowrun-results data …` through Commander, as the CLI does, with exits turned into throws. */
const run = async (...args: string[]): Promise<void> => {
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
    .option('--json');
  registerFlowrunResultsCommands(program);
  await program.parseAsync(['--json', 'flowrun-results', 'data', ...args], { from: 'user' });
};

describe('flowrun-results data', () => {
  it('passes the root path to the client and outputs what the API returns', async () => {
    await flowrunResultsData(RESULT_ID, { rootPath: 'memory' }, command);

    expect(client.getJobResultData).toHaveBeenCalledWith('test-org', 'test-workspace', RESULT_ID, 'memory');
    expect(mocks.output).toHaveBeenCalledWith({ default: [{ ok: true }] }, { json: true });
  });

  it.each(['memory', 'messages'] as const)('accepts --root-path %s', async (rootPath) => {
    await run(RESULT_ID, '--root-path', rootPath);

    expect(client.getJobResultData).toHaveBeenCalledWith('test-org', 'test-workspace', RESULT_ID, rootPath);
  });

  it('rejects a root path the API does not serve before making a client', async () => {
    const error = await run(RESULT_ID, '--root-path', 'ctx').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.invalidArgument');
    expect((error as CommanderError).message).toContain('Allowed choices are memory, messages');
    expect(mocks.createClientWithContext).not.toHaveBeenCalled();
  });

  it('requires --root-path', async () => {
    const error = await run(RESULT_ID).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.missingMandatoryOptionValue');
    expect(mocks.createClientWithContext).not.toHaveBeenCalled();
  });
});
