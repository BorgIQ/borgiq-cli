import { loadConfig } from '../config/index.js';
import type { CliConfig } from '../config/index.js';
import { BorgIQClient } from '../client/index.js';

export interface ResolvedContext {
  apiUrl: string;
  apiToken: string;
  org: string;
  workspace: string;
}

export interface GlobalOptions {
  apiUrl?: string;
  token?: string;
  org?: string;
  workspace?: string;
  json?: boolean;
}

const resolveValue = (flag: string | undefined, envVar: string, configValue: string | undefined): string | undefined => {
  return flag || process.env[envVar] || configValue;
};

export const resolveAuth = (opts: GlobalOptions): { apiUrl: string; apiToken: string } => {
  const config = loadConfig();

  const apiUrl = resolveValue(opts.apiUrl, 'BORGIQ_API_URL', config?.apiUrl);
  const apiToken = resolveValue(opts.token, 'BORGIQ_API_TOKEN', config?.apiToken);

  if (!apiUrl) {
    process.stderr.write('Error: API URL is required. Use --api-url, set BORGIQ_API_URL, or run \'borgiq auth login\'.\n');
    process.exit(1);
  }

  if (!apiToken) {
    process.stderr.write('Error: API token is required. Use --token, set BORGIQ_API_TOKEN, or run \'borgiq auth login\'.\n');
    process.exit(1);
  }

  return { apiUrl, apiToken };
};

export const resolveContext = (opts: GlobalOptions): ResolvedContext => {
  const { apiUrl, apiToken } = resolveAuth(opts);
  const config = loadConfig();

  const org = resolveValue(opts.org, 'BORGIQ_ORG', config?.defaultOrg);
  const workspace = resolveValue(opts.workspace, 'BORGIQ_WORKSPACE', config?.defaultWorkspace);

  if (!org) {
    process.stderr.write('Error: Organization is required. Use --org, set BORGIQ_ORG, or run \'borgiq auth login\' with a default org.\n');
    process.exit(1);
  }

  if (!workspace) {
    process.stderr.write('Error: Workspace is required. Use --workspace, set BORGIQ_WORKSPACE, or run \'borgiq auth login\' with a default workspace.\n');
    process.exit(1);
  }

  return { apiUrl, apiToken, org, workspace };
};

export const createClient = (opts: GlobalOptions): BorgIQClient => {
  const { apiUrl, apiToken } = resolveAuth(opts);
  return new BorgIQClient(apiUrl, apiToken);
};

export const createClientWithContext = (opts: GlobalOptions): { client: BorgIQClient; ctx: ResolvedContext } => {
  const ctx = resolveContext(opts);
  const client = new BorgIQClient(ctx.apiUrl, ctx.apiToken);
  return { client, ctx };
};
