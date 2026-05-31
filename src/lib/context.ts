import { loadConfig } from '../config/index.js';
import type { CliConfig } from '../config/index.js';
import { BorgIQClient } from '../client/index.js';
import { CliUsageError } from './errors.js';

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
    throw new CliUsageError("API URL is required. Use --api-url, set BORGIQ_API_URL, or run 'borgiq auth login'.");
  }

  if (!apiToken) {
    throw new CliUsageError("API token is required. Use --token, set BORGIQ_API_TOKEN, or run 'borgiq auth login'.");
  }

  return { apiUrl, apiToken };
};

export const resolveContext = (opts: GlobalOptions): ResolvedContext => {
  const { apiUrl, apiToken } = resolveAuth(opts);
  const config = loadConfig();

  const org = resolveValue(opts.org, 'BORGIQ_ORG', config?.defaultOrg);
  const workspace = resolveValue(opts.workspace, 'BORGIQ_WORKSPACE', config?.defaultWorkspace);

  if (!org) {
    throw new CliUsageError(
      "Organization is required. Use --org, set BORGIQ_ORG, or run 'borgiq auth login' with a default org.",
    );
  }

  if (!workspace) {
    throw new CliUsageError(
      "Workspace is required. Use --workspace, set BORGIQ_WORKSPACE, or run 'borgiq auth login' with a default workspace.",
    );
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
