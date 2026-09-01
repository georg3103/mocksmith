const parseHttpStatus = (raw: string): number => {
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error(`--status must be an integer between 100 and 599, got: ${raw}`);
  }

  return value;
};

const parseDelay = (raw: string): number => {
  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--delay must be a non-negative number, got: ${raw}`);
  }

  return value;
};

export const endpointOptionParsers = {
  delay: parseDelay,
  httpStatus: parseHttpStatus,
};
