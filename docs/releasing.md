# Releasing

taskwire is published on npm as `@richi2293/taskwire`. Node does not strip TypeScript types inside `node_modules`, so the package ships JavaScript compiled from `src/` (`tsconfig.build.json`). Only CI compiles it: development runs the TypeScript sources with no build step.

## Steps

1. Open a pull request that moves the `Unreleased` section of `CHANGELOG.md` to the new version and bumps `version` in `package.json`.
2. Merge it once CI passes. The `package` job has already built the package, installed it and run it.
3. Tag the merge commit on `main` and push the tag:

   ```
   git checkout main && git pull
   git tag -a v0.1.3 -m "v0.1.3"
   git push origin v0.1.3
   ```

4. The `release` workflow checks that the tag matches `package.json`, runs the tests, builds and checks the package, then publishes it on npm with provenance.
5. Create the GitHub release with the changelog section as notes: `gh release create v0.1.3 --notes-file <file>`.

## Trusted publishing

The workflow publishes through npm trusted publishing: npm trusts the `release.yml` workflow of this repository through OIDC, so no npm token is stored in GitHub.

It is configured on npmjs.com, in the package settings, under "Trusted publisher": GitHub Actions, repository `Richi2293/taskwire`, workflow `release.yml`.

## First publication

The trusted publisher can be set only on a package that already exists, so the first version is published by hand, from a clean checkout of the release commit on `main`, before pushing its tag:

```
npm login
git checkout main && git pull
npm install --no-save --no-package-lock typescript@7.0.2 @types/node@24
PATH="$PWD/node_modules/.bin:$PATH" scripts/check-package.sh
npm publish
```

Then push the tag and set the trusted publisher as above: the workflow sees that the version is already on npm and skips publishing it. From the next version on, pushing the tag is enough.
