import type { Command } from 'commander';

import { flowrunResultsSummaries } from './summaries.js';
import { flowrunResultsData } from './data.js';

export const registerFlowrunResultsCommands = (program: Command): void => {
  const results = program.command('flowrun-results').description('Inspect flow run job results');

  results
    .command('summaries')
    .description('Get result summaries for a job')
    .requiredOption('--job-id <id>', 'Flowrun job ID')
    .action(flowrunResultsSummaries);

  results
    .command('data <resultId>')
    .description('Get full result data for a job result')
    .action(flowrunResultsData);
};
