import { Option, type Command } from 'commander';

import type { JobResultDataRootPath } from '../../client/types.js';
import { flowrunResultsSummaries } from './summaries.js';
import { flowrunResultsData } from './data.js';

const RESULT_DATA_ROOT_PATHS = ['memory', 'messages'] satisfies JobResultDataRootPath[];

export const registerFlowrunResultsCommands = (program: Command): void => {
  const results = program.command('flowrun-results').description('Inspect flow run job results');

  results
    .command('summaries')
    .description('Get result summaries for a job')
    .requiredOption('--job-id <id>', 'Flowrun job ID')
    .action(flowrunResultsSummaries);

  results
    .command('data <resultId>')
    .description("Get one root of a job result: the actor's memory or the messages it emitted")
    .addOption(new Option('--root-path <path>', 'Result root to fetch').choices(RESULT_DATA_ROOT_PATHS).makeOptionMandatory())
    .action(flowrunResultsData);
};
