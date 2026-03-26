import { deleteConfig, configExists } from '../../config/index.js';

export const authLogout = (): void => {
  if (!configExists()) {
    process.stderr.write('No configuration found. Already logged out.\n');
    return;
  }

  deleteConfig();
  process.stderr.write('Logged out. Configuration removed.\n');
};
