# @mocksmith/scenarios

Named, declarative scenarios for [mocksmith](https://github.com/georg3103/mocksmith):
a session patch plus endpoint overrides, applied from the CLI, from tests, or
from code.

```bash
npm install --save-dev @mocksmith/scenarios
```

Register the plugin in your config:

```ts
import { defineMockerConfig } from 'mocksmith/config';
import { scenarios } from '@mocksmith/scenarios/plugin';

export default defineMockerConfig({
  handlers: [handlers],
  defaultSessionData: session,
  plugins: [scenarios({ dir: './mocks' })],
});
```

Then scenarios have names:

```bash
npx mocksmith scenario list
npx mocksmith scenario apply "Degraded shop"
npx mocksmith scenario clear
```

## Entry points

| Import | Contents |
| --- | --- |
| `@mocksmith/scenarios` | `defineScenario`, `defineTestScenario`, `applyScenarioViaApi`, types |
| `@mocksmith/scenarios/plugin` | the `scenarios()` plugin and `loadScenario` (Node) |
| `@mocksmith/scenarios/playwright` | `applyScenario(page, scenario \| name)` |

## License

MIT
