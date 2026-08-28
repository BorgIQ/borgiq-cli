import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientWithContext: vi.fn(),
  output: vi.fn(),
}));

vi.mock('../../src/lib/context.js', () => ({
  createClientWithContext: mocks.createClientWithContext,
}));

vi.mock('../../src/output/index.js', () => ({
  output: mocks.output,
}));

import { workspacesDeployment } from '../../src/commands/workspaces/deployment.js';
import type { WorkspaceDeploymentStatus } from '../../src/client/types.js';

const command = { parent: { parent: { opts: () => ({ json: true }) } } };
const tableCommand = { parent: { parent: { opts: () => ({ json: false }) } } };

const status = (over: Partial<WorkspaceDeploymentStatus> = {}): WorkspaceDeploymentStatus => ({
  isDeployed: false,
  canvases: [
    {
      id: 'CANV01a0000000000000000000000',
      slug: 'orders',
      name: 'Orders',
      codeActorCount: 2,
      activeBuild: null,
      latestBuild: null,
      outdated: false,
      buildable: true,
    },
  ],
  ...over,
});

const makeClient = () => ({
  getWorkspaceDeployment: vi.fn(),
  updateWorkspaceDeployment: vi.fn(),
  buildAllRuntimeBuilds: vi.fn(),
});

let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;
let stdout: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderr.mockRestore();
  stdout.mockRestore();
  vi.clearAllMocks();
});

describe('workspaces deployment', () => {
  it('shows the status without changing anything', async () => {
    client.getWorkspaceDeployment.mockResolvedValue(status());

    await workspacesDeployment({}, command);

    expect(client.updateWorkspaceDeployment).not.toHaveBeenCalled();
    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({ isDeployed: false }), expect.anything());
  });

  it('turns deployment on, then reports the new state', async () => {
    client.getWorkspaceDeployment.mockResolvedValue(status({ isDeployed: true }));

    await workspacesDeployment({ enable: true }, command);

    expect(client.updateWorkspaceDeployment).toHaveBeenCalledWith('test-org', 'test-workspace', true);
    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({ isDeployed: true }), expect.anything());
  });

  it('turns deployment off', async () => {
    client.getWorkspaceDeployment.mockResolvedValue(status());

    await workspacesDeployment({ disable: true }, command);

    expect(client.updateWorkspaceDeployment).toHaveBeenCalledWith('test-org', 'test-workspace', false);
  });

  it('refuses --enable and --disable together', async () => {
    // handleError exits with the usage code; stub it so the assertion can run.
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    try {
      await expect(workspacesDeployment({ enable: true, disable: true }, command)).rejects.toThrow('process.exit:2');
      expect(client.updateWorkspaceDeployment).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('either --enable or --disable'));
    } finally {
      exit.mockRestore();
    }
  });

  it('reports what --build-all skipped, so a partial start is never silent', async () => {
    client.buildAllRuntimeBuilds.mockResolvedValue({
      builds: [{ canvasId: 'CANV01a0000000000000000000000', buildId: 'CRBD01a0000000000000000000000' }],
      skipped: [{ canvasId: 'CANV02b0000000000000000000000', reason: 'runtime-too-small' }],
    });

    await workspacesDeployment({ buildAll: true }, tableCommand);

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('runtime-too-small'));
  });

  it('renders a summary row per canvas, with the reason a canvas cannot be built', async () => {
    client.getWorkspaceDeployment.mockResolvedValue(status({
      isDeployed: true,
      canvases: [
        {
          id: 'CANV01a0000000000000000000000',
          slug: 'orders',
          name: 'Orders',
          codeActorCount: 2,
          activeBuild: { id: 'CRBD01', canvasId: 'CANV01a0000000000000000000000', status: 'ready', runtimeSlug: 'default', actors: {}, createdAt: '', isActive: true },
          latestBuild: { id: 'CRBD01', canvasId: 'CANV01a0000000000000000000000', status: 'ready', runtimeSlug: 'default', actors: {}, createdAt: '', isActive: true },
          outdated: true,
          buildable: true,
        },
        {
          id: 'CANV02b0000000000000000000000',
          slug: 'reports',
          name: 'Reports',
          codeActorCount: 0,
          activeBuild: null,
          latestBuild: null,
          outdated: false,
          buildable: false,
          blockedReason: 'no-code-actors',
        },
      ],
    }));

    await workspacesDeployment({}, tableCommand);

    expect(mocks.output).toHaveBeenCalledWith(
      [
        expect.objectContaining({ slug: 'orders', running: 'ready', state: 'outdated' }),
        expect.objectContaining({ slug: 'reports', running: '—', state: 'no-code-actors' }),
      ],
      expect.anything(),
      expect.objectContaining({ title: 'Deployment — ON' }),
    );
  });
});
