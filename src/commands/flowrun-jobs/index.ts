import type { Command } from 'commander';

import { flowrunJobsList } from './list.js';
import { flowrunJobsTestRun } from './test-run.js';
import { flowrunJobsReRun } from './re-run.js';
import { flowrunJobsRuntimeData } from './runtime-data.js';
import { flowrunJobsAiTimeline } from './ai-timeline.js';
import { flowrunJobsSourceMessage } from './source-message.js';

export const registerFlowrunJobsCommands = (program: Command): void => {
  const jobs = program.command('flowrun-jobs').description('Manage flow run jobs');

  jobs
    .command('list')
    .description('List flow run jobs')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .option('--canvas-id <id>', 'Filter by canvas ID')
    .option('--actor-id <id>', 'Filter by actor ID')
    .option('--flowrun-id <id>', 'Filter by flowrun ID')
    .action(flowrunJobsList);

  jobs
    .command('test-run')
    .description('Test run a single actor')
    .requiredOption('--canvas-id <id>', 'Canvas ID')
    .requiredOption('--actor-id <id>', 'Actor ID')
    .option('--publish', 'Publish emitted messages to downstream actors')
    .action(flowrunJobsTestRun);

  jobs
    .command('re-run')
    .description('Re-run a previous job with latest config')
    .requiredOption('--job-id <id>', 'Flowrun job ID to re-run')
    .option('--no-publish', 'Do not publish emitted messages to downstream actors')
    .action(flowrunJobsReRun);

  jobs
    .command('runtime-data <jobId>')
    .description('Get runtime data for a job (what the actor received)')
    .option('--root-path <path>', 'Data root path: ctx, msg, request, user, or inputs')
    .action(flowrunJobsRuntimeData);

  jobs
    .command('ai-timeline <jobId>')
    .description('Get AI agent tool-use timeline for a job')
    .action(flowrunJobsAiTimeline);

  jobs
    .command('source-message <jobId>')
    .description('Get the source message that triggered a job')
    .action(flowrunJobsSourceMessage);
};
