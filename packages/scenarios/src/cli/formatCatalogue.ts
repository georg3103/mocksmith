export type ScenarioSummary = {
  name: string;
  source?: string;
  feature?: string;
  description?: string;
  order?: number;
  endpoints: number;
};

/** The catalogue as `mocksmith scenario list` prints it: grouped by feature. */
export const formatCatalogue = (scenarios: ScenarioSummary[]) => {
  if (!scenarios.length) {
    return 'No scenarios registered. Point the plugin at your files: scenarios({ dir: "." }).';
  }

  const groups = new Map<string, ScenarioSummary[]>();

  for (const scenario of scenarios) {
    const feature = scenario.feature ?? 'Scenarios';

    groups.set(feature, [...(groups.get(feature) ?? []), scenario]);
  }

  return [...groups.entries()]
    .map(([feature, items]) => {
      const lines = items
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
        .map((item) => {
          const suffix = item.description ? ` — ${item.description}` : '';

          return `  ${item.name}${suffix}`;
        });

      return [`${feature}:`, ...lines].join('\n');
    })
    .join('\n\n');
};
