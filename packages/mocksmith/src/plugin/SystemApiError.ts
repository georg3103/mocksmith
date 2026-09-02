/**
 * Thrown by `ctx.callSystemApi` when a system route answers 4xx or 5xx.
 *
 * The in-process caller used to hand back the response body and drop the
 * status, which made a 404 indistinguishable from success — a plugin could
 * "apply" a scenario that does not exist and report nothing.
 * */
export class SystemApiError extends Error {
  public readonly name = 'SystemApiError';

  public constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`The system route "${endpoint}" answered ${status}`);
  }
}
