import { useCallback, useEffect, useState } from 'react';

import { system, type ScenarioSummary } from './api';

export type ScenarioMenuProps = {
  /** Called after the world changed, so the page can reload what it shows. */
  onApplied: (scenario: string | undefined) => void;
  onLog: (text: string) => void;
  sessionId: string;
};

/** `getOverrides` answers with the list itself, one entry per overridden path. */
type OverrideList = { path: string }[];

const group = (scenarios: ScenarioSummary[]) => {
  const groups = new Map<string, ScenarioSummary[]>();

  for (const scenario of scenarios) {
    const feature = scenario.feature ?? 'Scenarios';

    groups.set(feature, [...(groups.get(feature) ?? []), scenario]);
  }

  return [...groups.entries()].map(
    ([feature, items]) =>
      [
        feature,
        items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
      ] as const
  );
};

/**
 * The scenario catalogue, in the app itself — a dev panel of the kind a real
 * project grows, built on the same system API the CLI uses:
 * `scenarios` lists, `applyScenario` applies, `clearScenario` clears.
 *
 * Every call names `sessionId`, and that matters: without it the server would
 * reshape its default session while this tab looks at its own.
 * */
export const ScenarioMenu = ({ onApplied, onLog, sessionId }: ScenarioMenuProps) => {
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [active, setActive] = useState<string>();
  const [overrides, setOverrides] = useState(0);
  const [busy, setBusy] = useState(false);

  /**
   * The number of active overrides comes from the server on every change.
   * The name above it does not: nothing on the server remembers which scenario
   * was applied, so it is this tab's memory and disappears with a reload —
   * which is the honest thing for it to do.
   * */
  const readOverrides = useCallback(async () => {
    const list = await system<OverrideList>('getOverrides', { id: sessionId });

    setOverrides(list.length);
  }, [sessionId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void (async () => {
      const catalogue = await system<{ scenarios: ScenarioSummary[] }>('scenarios', {});

      setScenarios(catalogue.scenarios);
      await readOverrides();
    })();
  }, [open, readOverrides]);

  const apply = async (name: string) => {
    setBusy(true);

    try {
      await system('applyScenario', { id: sessionId, name, clearExisting: true });
      setActive(name);
      onLog(`scenario applied · ${name}`);
      await readOverrides();
      onApplied(name);
    } catch (error) {
      onLog(`scenario failed · ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);

    try {
      await system('clearScenario', { id: sessionId });
      setActive(undefined);
      onLog('scenario cleared');
      await readOverrides();
      onApplied(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scenarios">
      <button
        className="button button--ghost"
        data-testid="scenarios-open"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Scenarios
        {active ? <span className="badge badge--on">1</span> : null}
      </button>

      {open && (
        <div className="panel" data-testid="scenario-panel">
          <p className="panel__head">
            <span data-testid="active-scenario">{active ?? 'No scenario applied'}</span>
            <span className="mono" data-testid="active-overrides">
              {overrides} override(s)
            </span>
          </p>

          {group(scenarios).map(([feature, items]) => (
            <section key={feature}>
              <h3>{feature}</h3>
              {items.map((scenario) => (
                <button
                  className={scenario.name === active ? 'scenario scenario--on' : 'scenario'}
                  data-testid="scenario-item"
                  disabled={busy}
                  key={scenario.name}
                  onClick={() => void apply(scenario.name)}
                  type="button"
                >
                  <strong>{scenario.name}</strong>
                  <span>{scenario.description}</span>
                </button>
              ))}
            </section>
          ))}

          <button
            className="button button--ghost"
            data-testid="scenario-clear"
            disabled={busy}
            onClick={() => void clear()}
            type="button"
          >
            Clear overrides
          </button>

          <p className="panel__foot mono">
            The same catalogue is in the terminal: <code>mocksmith scenario list</code>
          </p>
        </div>
      )}
    </div>
  );
};
