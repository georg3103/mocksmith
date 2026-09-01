import type { MockApiBase } from '../context/context';

import type { OverrideResponse, OverrideRule } from '../types';

export type ScenarioEndpoint = OverrideRule & {
  path: string;
  /**
   * @deprecated Single-response alias kept for older scenarios: equivalent to
   * `responses: [response]`. Prefer inline fields or `responses`.
   * */
  response?: OverrideResponse;
};

/**
 * The starting state of the world for a scenario.
 * */
export type ScenarioSession = {
  patch?: Partial<MockApiBase>;
  /** Sugar merged into `apiData.remoteConfigFlags`. */
  flags?: Record<string, boolean>;
};

/**
 * A full scenario.
 * */
export type Scenario = {
  name?: string;
  /** Set to `false` to skip reloading the app after applying. */
  reload?: boolean;
  session?: ScenarioSession;
  endpoints?: ScenarioEndpoint[];
  /** Grouping label for scenario catalogs (dev UI). */
  feature?: string;
  /** Human instructions: what to look at after applying. */
  description?: string;
  /** Sort order within the feature group. */
  order?: number;
};

export type TestScenario = Omit<Scenario, 'session'>;
