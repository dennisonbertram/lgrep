# Releasing lgrep

This repo is set up to publish `lgrep` to npm from GitHub Actions.

## One-time setup

Use npm trusted publishing for this package instead of a long-lived `NPM_TOKEN`.

In npm package settings for `lgrep`, add a GitHub Actions trusted publisher with:

- owner: `dennisonbertram`
- repository: `lgrep`
- workflow file: `.github/workflows/publish.yml`
- environment: leave blank unless you later decide to gate releases behind a GitHub Actions environment

After that, the `publish.yml` workflow can publish to npm using GitHub's OIDC identity and npm will attach provenance automatically.

If you want a stronger fallback while bootstrapping, you can temporarily add a repository secret named `NPM_TOKEN`, but trusted publishing is the preferred path.

## Before releasing

Make sure `main` is up to date and the working tree is clean, then run:

```bash
npm run release:check
```

That runs:

- `npm run type-check`
- `npm run build`
- `npm test`
- `npm pack --dry-run`

## Cutting a release

Pick the next semantic version and create the tag from `main`:

```bash
npm version patch
git push origin main --follow-tags
```

For a feature release, use `minor` instead of `patch`:

```bash
npm version minor
git push origin main --follow-tags
```

`npm version` updates `package.json`, updates `package-lock.json`, creates a commit, and creates a matching git tag like `v0.2.0`.

Pushing that tag triggers `.github/workflows/publish.yml`, which:

1. installs dependencies
2. verifies the tag matches `package.json`
3. runs type-check, build, and tests
4. publishes the package to npm

## Optional GitHub release notes

Publishing to npm does not automatically create a GitHub release entry. If you want release notes on GitHub too, create one from the same tag after the publish succeeds:

```bash
gh release create "v$(node -p \"require('./package.json').version\")" --generate-notes
```

## Current package status

As of April 9, 2026, `npm view lgrep version` returns `0.1.0`, so the next release should use a higher version.
