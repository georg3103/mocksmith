export const readApiResponse = async <T>(endpoint: string, response: Response): Promise<T> => {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${endpoint} responded with ${response.status}: ${text}`);
  }

  if (!text) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${endpoint} responded with malformed JSON: ${text}`);
  }
};
