import type { Command } from 'commander';

import { authLogin } from './login.js';
import { authLogout } from './logout.js';
import { authStatus } from './status.js';

export const registerAuthCommands = (program: Command): void => {
  const auth = program.command('auth').description('Manage authentication');

  auth
    .command('login')
    .description('Configure API key and base URL')
    .option('--api-url <url>', 'BorgIQ API URL')
    .option('--token <token>', 'API token (biq_...)')
    .action(authLogin);

  auth
    .command('logout')
    .description('Remove stored credentials')
    .action(authLogout);

  auth
    .command('status')
    .description('Show current authentication status')
    .action(authStatus);
};
