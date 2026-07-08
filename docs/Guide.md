# Sale Sync API Guide

## Updating the `@sale-sync/shared` Package

`@sale-sync/shared` lives in `packages/` and is distributed to each Lambda service as a local tarball (`vendor/shared.tgz`) rather than being published to npm.

### How it works

1. Source lives in `packages/src/`
2. `make shared.pack` compiles it to `packages/dist/` and copies the tarball into each service's `vendor/` folder
3. Each service installs from `"@sale-sync/shared": "file:vendor/shared.tgz"` in its `package.json`

### Workflow after editing `packages/src/`

```bash
make shared.pack   # recompile + repack tarball into all vendor/ folders
make deps.all      # force-reinstall from the new tarball in all services
```

Or in one shot (also rebundles all Lambdas):

```bash
make bundle
```

### Why `make shared.pack` alone is not enough

Updating the tarball in `vendor/` does **not** automatically update `node_modules/`. npm caches the previously installed version and won't re-extract the tarball unless you explicitly uninstall and reinstall. `make deps.all` (and the individual `make deps.<service>` targets) handle this by running:

```bash
npm uninstall @sale-sync/shared
rm -rf node_modules/@sale-sync/shared
npm install @sale-sync/shared@file:vendor/shared.tgz
```

Skipping this step leaves `node_modules/@sale-sync/shared` stale, which causes:
- TypeScript errors: `Module '"@sale-sync/shared"' has no exported member '...'`
- Runtime 500 errors if the bundle was rebuilt against the stale install (missing exports resolve to `undefined` at runtime)

### Quick reference

| Command | What it does |
|---|---|
| `make shared.pack` | Recompile `packages/src/` and update all `vendor/shared.tgz` files |
| `make deps.all` | Reinstall `@sale-sync/shared` in all services from vendor tarballs |
| `make deps.<service>` | Reinstall in a single service (`auth`, `organisation`, `media`, `blocks`) |
| `make bundle` | `shared.pack` + `deps.all` + esbuild bundle for all Lambdas |
