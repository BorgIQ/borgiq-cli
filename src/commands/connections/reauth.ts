import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { resolveWebUrl } from '../../lib/webUrl.js';
import { openUrl } from '../../lib/openUrl.js';

interface ReauthOptions {
  timeout?: string;
  webUrl?: string;
}

export const connectionsReauth = async (id: string, options: ReauthOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    // Confirm this connection supports OAuth2 reauth.
    try {
      await client.getConnectionReAuthData(ctx.org, ctx.workspace, id);
    } catch {
      process.stderr.write(`Error: Connection ${id} does not support OAuth2 reauth.\n`);
      process.exit(1);
    }

    const before = await findConnectionUpdatedAt(client, ctx, id);

    const webUrl = resolveWebUrl(options.webUrl, ctx.apiUrl);
    const target = `${webUrl}/orgs/${ctx.org}/workspaces/${ctx.workspace}/connections/${id}`;

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Opening ${target}\n`);
      process.stderr.write('Re-authenticate the connection in your browser. Waiting for completion...\n');
    }
    openUrl(target);

    const timeoutSec = options.timeout ? parseInt(options.timeout, 10) : 300;
    const updated = await pollUntilUpdated(client, ctx, id, before, timeoutSec);
    if (!updated) {
      process.stderr.write(`Error: Timed out after ${timeoutSec}s waiting for reauth.\n`);
      process.exit(1);
    }

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Connection reauthenticated: ${updated.key} (${updated.id})\n`);
    }
    output(updated, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

const findConnectionUpdatedAt = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  id: string,
): Promise<string | undefined> => {
  const result = await client.listConnections(ctx.org, ctx.workspace, { pageSize: 100 });
  const record = result.data.find((r) => r.id === id);
  return (record as { updatedAt?: string } | undefined)?.updatedAt;
};

const pollUntilUpdated = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  id: string,
  before: string | undefined,
  timeoutSec: number,
): Promise<{ id: string; key: string; [k: string]: unknown } | null> => {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const result = await client.listConnections(ctx.org, ctx.workspace, { pageSize: 100 });
    const record = result.data.find((r) => r.id === id) as { id: string; key: string; updatedAt?: string } | undefined;
    if (record && record.updatedAt && record.updatedAt !== before) {
      return record;
    }
  }
  return null;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
