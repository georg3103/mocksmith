# @mocksmith/eslint-plugin

An ESLint rule that keeps [mocksmith](https://github.com/georg3103/mocksmith)
scenario files declarative: only imports and scenario definitions at the top
level, with case constants living next to the test so the mock and the
assertions share one constant instead of drifting apart.

```bash
npm install --save-dev @mocksmith/eslint-plugin
```

```js
// eslint.config.js
import mocksmith from '@mocksmith/eslint-plugin';

export default [
  {
    files: ['**/*.scenario.ts'],
    plugins: { mocksmith },
    rules: { 'mocksmith/scenario-file-purity': 'error' },
  },
];
```

## License

MIT
