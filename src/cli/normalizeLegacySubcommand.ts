/**
 * Expands a legacy shorthand into its full form by inserting the default
 * subcommand: `mocksmith endpoint /api/x --status 500` becomes
 * `mocksmith endpoint set /api/x --status 500`.
 *
 * Mutates `argv` in place, which is safe as long as it runs before the parser
 * reads it.
 * */
export const normalizeLegacySubcommand = (
  argv: string[],
  commandName: string,
  subcommands: string[],
  defaultSubcommand: string
) => {
  const commandIndex = argv.indexOf(commandName);
  const nextArgument = argv[commandIndex + 1];

  if (
    commandIndex !== -1 &&
    nextArgument &&
    !nextArgument.startsWith('-') &&
    !subcommands.includes(nextArgument)
  ) {
    argv.splice(commandIndex + 1, 0, defaultSubcommand);
  }

  return argv;
};
