export const revivePatchDate = (patch: object): object => {
  const { date } = patch as { date?: unknown };

  if (typeof date === 'string') {
    return { ...patch, date: new Date(date) };
  }

  return patch;
};
