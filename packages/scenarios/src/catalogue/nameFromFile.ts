/** Falls back to the file name: `degraded.scenario.ts` → `degraded`. */
export const scenarioNameFromFile = (filePath: string) => {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;

  return base.replace(/\.scenario\.[^.]+$/, '').replace(/\.[^.]+$/, '');
};
