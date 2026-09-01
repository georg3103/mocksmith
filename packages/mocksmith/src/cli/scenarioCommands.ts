import type { Command } from 'commander';

import { applyScenarioViaApi } from '../scenario/applyScenarioViaApi';
import { loadScenario } from '../scenario/loadScenario';

import type { CliContext } from './context';

/**
 * Scenario commands.
 *
 * NOTE: this module is the seam where scenarios leave the core. It will move to
 * the @mocksmith/scenarios package and be registered through the plugin CLI API
 * instead of being wired in here.
 * */
export const addScenarioCommands = (program: Command, ctx: CliContext) => {
  const { callApi, sessionId, log } = ctx;

  const applyScenario = async (file: string, opts: { reload?: boolean }) => {
    const scenario = await loadScenario(file);

    const summary = await applyScenarioViaApi(scenario, callApi, {
      sessionId,
      clearExisting: true,
    });

    log.info(
      `✅ scenario "${scenario.name ?? file}" applied: ${summary.paths} endpoint(s), ${
        summary.rules
      } rule(s)`
    );

    if (summary.reloadRequested && opts.reload !== false) {
      await ctx.reloadApp();
      log.info('✅ browser reload requested');
    } else {
      log.info('reload the page so the app re-reads the data');
    }
  };

  const clearScenario = async () => {
    await callApi('clearOverride', { id: sessionId, all: true });
    log.info('✅ scenario overrides cleared (for a full rollback run mocksmith session reset)');
  };

  const scenarioCommand = program.command('scenario').description('Mock scenario management');

  scenarioCommand
    .command('apply <file>')
    .description('Apply a *.scenario.ts file: mock state + endpoint overrides')
    .option('--no-reload', 'do not reload the browser after applying')
    .action(applyScenario);

  scenarioCommand.command('clear').description('Clear all scenario overrides').action(clearScenario);

  program
    .command('scenario-apply <file>', { hidden: true })
    .option('--no-reload')
    .action(applyScenario);
  program.command('scenario-clear', { hidden: true }).action(clearScenario);

  return program;
};
