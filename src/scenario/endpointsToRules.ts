import type { OverrideListEntry, OverrideRule } from '../types';
import type { ScenarioEndpoint } from './types';

/**
 * Transforms scenario endpoints into engine rules:
 * `ScenarioEndpoint[] → OverrideListEntry[]`.
 * */
export function endpointsToRules(endpoints: ScenarioEndpoint[] = []): OverrideListEntry[] {
  const byPath = new Map<string, OverrideRule[]>();

  for (const { path, response, ...rule } of endpoints) {
    // Deprecated `response` alias: equivalent to a single-element `responses`.
    const normalized = response && !rule.responses?.length ? { ...rule, ...response } : rule;

    byPath.set(path, [...(byPath.get(path) ?? []), normalized]);
  }

  return [...byPath.entries()].map(([path, rules]) => ({ path, rules }));
}
