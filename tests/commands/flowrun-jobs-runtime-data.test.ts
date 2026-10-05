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

import { registerFlowrunJobsCommands } from '../../src/commands/flowrun-jobs/index.js';

const JOB_ID = 'FRJB01job000000000000000000000';

let client: { getJobRuntimeData: ReturnType<typeof vi.fn> };

beforeEach(() => {
  client = { getJobRuntimeData: vi.fn().mockResolvedValue({}) };
  mocks.createClientWithContext.mockReset().mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
});

/** Parses `flowrun-jobs runtime-data …` through Commander, as the CLI does, with exits turned into throws. */
const run = async (...args: string[]): Promise<void> => {
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
    .option('--json');
  registerFlowrunJobsCommands(program);
  await program.parseAsync(['--json', 'flowrun-jobs', 'runtime-data', ...args], { from: 'user' });
};

describe('flowrun-jobs runtime-data', () => {
  it.each(['ctx', 'trigger', 'inputs'] as const)('accepts --root-path %s', async (rootPath) => {
    await run(JOB_ID, '--root-path', rootPath);

    expect(client.getJobRuntimeData).toHaveBeenCalledWith('test-org', 'test-workspace', JOB_ID, rootPath);
  });

  it.each(['request', 'user'])('rejects the retired root path %s before making a client', async (rootPath) => {
    const error = await run(JOB_ID, '--root-path', rootPath).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.invalidArgument');
    expect((error as CommanderError).message).toContain('Allowed choices are ctx, trigger, inputs');
    expect(mocks.createClientWithContext).not.toHaveBeenCalled();
  });
});
