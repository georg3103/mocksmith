const MOCKSMITH_URI = process.env.MOCKSMITH_URI;

export function getMockBackendUri() {
  if (!MOCKSMITH_URI) {
    throw Error('Mock server URI is not set, run with "export MOCKSMITH_URI=<uri>"');
  }

  return MOCKSMITH_URI;
}
