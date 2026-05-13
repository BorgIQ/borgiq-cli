import type { Command } from 'commander';

import { authLogin } from './login.js';
import { authLogout } from './logout.js';
import { authStatus } from './status.js';
import { authHandoffUrl } from './handoffUrl.js';
import { authSelect } from './select.js';

export const registerAuthCommands = (program: Command): void => {
  const auth = program.command('auth').description('Manage authentication');

  auth
    .command('login')
    .description('Configure API key and base URL')
    .option('--api-url <url>', 'BorgIQ API URL')
    .option('--token <token>', 'API token (biq_...)')
    .option('--web-url <url>', 'Web app URL used for OAuth2 handoff')
    .option('--org <org>', 'Default organization slug or ID to save')
    .option('--workspace <workspace>', 'Default workspace slug or ID to save')
    .action((options, command) => authLogin(options, command));

  auth
    .command('logout')
    .description('Remove stored credentials')
    .action(authLogout);

  auth
    .command('status')
    .description('Show current authentication status')
    .action(authStatus);

  auth
    .command('handoff-url')
    .description('Print a one-time URL that authenticates a headless browser as you (15-minute session)')
    .option('--redirect <path>', 'Relative path to redirect to after authentication (default: /)')
    .action(authHandoffUrl);

  auth
    .command('select')
    .description('Set the default org (and optionally workspace) used by other commands')
    .option('--org <org>', 'Organization slug or ID (required in non-interactive mode)')
    .option('--workspace <workspace>', 'Workspace slug or ID')
    .action((options, command) => authSelect(options, command));
};
