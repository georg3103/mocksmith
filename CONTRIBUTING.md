# Contributing

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

The browser suite lives in the demo app and needs a Chrome on the machine:

```bash
pnpm --filter mocksmith-example-vite-app run typecheck
cd examples/vite-app && pnpm test:e2e
```

## Commit messages decide the release

Commits follow [Conventional Commits](https://www.conventionalcommits.org),
because the version and the changelog are derived from them — nothing is bumped
or written by hand.

| Prefix | Effect on the next release |
| --- | --- |
| `fix: …` | patch — `0.2.0` → `0.2.1` |
| `feat: …` | minor — `0.2.0` → `0.3.0` |
| `feat: …` with `BREAKING CHANGE:` in the body | major (while below `1.0.0`, a minor) |
| `docs:`, `chore:`, `test:`, `ci:`, `refactor:`, `style:` | none on their own |

Write the subject as an imperative describing the change, not the file touched:
`fix: keep the session cookie when the port is reserved`, not `fix: update
session.ts`. Say *why* in the body — the subject becomes a changelog line, and
the body is what the next reader needs.

## Releases

A push to `main` runs the release workflow, and semantic-release takes it from
there: reads the commits since the last tag, writes `CHANGELOG.md`, sets one
version across the root manifest and all five packages, packs with pnpm,
publishes with npm, tags, opens a GitHub release, and commits the result back as
`chore(release): x.y.z [skip ci]`.

Everything about it is in
[docs/how-it-works.md § Build and release](docs/how-it-works.md#the-release-in-detail).
Three things worth repeating here:

- **The releases are locked together.** `mocksmith` and every `@mocksmith/*`
  always carry the same version, so matching versions mean compatibility.
- **`pnpm pack`, `npm publish`.** Only pnpm rewrites the `workspace:^` protocol
  into a real range; only npm performs the OIDC exchange behind trusted
  publishing. Neither tool can replace the other here.
- **Nothing publishes until it is switched on.** The release job is gated on the
  repository variable `RELEASE_ENABLED`; until it is `true`, a push to `main`
  runs CI only. A release can also be started by hand from the Actions tab
  (`workflow_dispatch`), which is how the first one is cut.
- **No one types a 2FA code into CI.** Authentication is an npm automation token
  in the `NPM_TOKEN` secret, and once every package exists on the registry it is
  replaced by trusted publishing — delete the secret and the workflow falls back
  to the OIDC exchange on its own.

To see what a release would upload, without touching the registry:

```bash
pnpm run build
pnpm run release:dry-run
```
