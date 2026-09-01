import type { Command } from 'commander';

import type { MocksmithPlugin, PluginCliArg, PluginCliCommand, PluginCliContext } from '../plugin/types';

/** Default subcommand a legacy shorthand expands to, e.g. `scenario x` → `scenario apply x`. */
export type LegacyDefault = { name: string; subcommand: string; known: string[] };

const buildArgs = (args: PluginCliArg[] = []) =>
  args
    .map((arg) => {
      const body = `${arg.name}${arg.variadic ? '...' : ''}`;

      return arg.required ? `<${body}>` : `[${body}]`;
    })
    .join(' ');

const attach = (parent: Command, spec: PluginCliCommand, ctx: PluginCliContext): Command => {
  const signature = [spec.name, buildArgs(spec.args)].filter(Boolean).join(' ');
  const command = parent.command(signature, { hidden: spec.hidden });

  if (spec.description) {
    command.description(spec.description);
  }

  for (const option of spec.options ?? []) {
    command.option(option.flags, option.description ?? '', option.defaultValue as never);
  }

  for (const child of spec.commands ?? []) {
    attach(command, child, ctx);
  }

  if (spec.action) {
    command.action(async (...argv: unknown[]) => {
      // commander passes the positional args, then the options, then the command
      const options = (argv[argv.length - 2] ?? {}) as Record<string, unknown>;
      const named = Object.fromEntries(
        (spec.args ?? []).map((arg, index) => [arg.name, argv[index] as string | string[]])
      );

      await spec.action?.(ctx, named, options);
    });
  }

  return command;
};

/**
 * Attaches the commands plugins declare. Plugins describe commands as data, so
 * this module is the only place that knows about commander — a plugin never
 * depends on the CLI framework.
 *
 * Returns the legacy shorthands to expand, since only the plugin knows which
 * subcommand its group defaults to.
 * */
export const registerPluginCommands = (
  program: Command,
  plugins: MocksmithPlugin[],
  ctx: PluginCliContext
): LegacyDefault[] => {
  const defaults: LegacyDefault[] = [];

  for (const plugin of plugins) {
    for (const spec of plugin.cli ?? []) {
      if (program.commands.some((command) => command.name() === spec.name)) {
        ctx.log.warn(
          `[mocksmith:${plugin.name}] the CLI command "${spec.name}" is already taken — skipping it`
        );

        continue;
      }

      attach(program, spec, ctx);

      if (spec.defaultSubcommand) {
        defaults.push({
          name: spec.name,
          subcommand: spec.defaultSubcommand,
          known: [...(spec.commands ?? []).map((child) => child.name), 'help'],
        });
      }
    }
  }

  return defaults;
};
