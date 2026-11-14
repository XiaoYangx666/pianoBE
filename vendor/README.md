# Vendored Tabletop dependency

`begame-tabletop-0.1.16.tgz` is a private dependency of `@piano/addon`. It is **not** distributed with this repository (`vendor/*.tgz` is ignored) and is not part of the git history. Its source lives in the private repository `https://github.com/ykxyx666/tabletop.git`, packed at commit `8f76d0f`.

A fresh clone therefore cannot build the addon until you provide the tarball yourself:

```bash
git clone git@github.com:ykxyx666/tabletop.git ../tabletop
npm run vendor:tabletop   # runs `npm pack` in ../tabletop (its prepack builds first)
npm install
```

`tools/pack-tabletop.mjs` also accepts an explicit checkout path: `node tools/pack-tabletop.mjs path/to/tabletop`. The tarball SHA-512 is pinned in the root `package-lock.json`; if a repack changes it, refresh the lockfile with `npm install` and commit the lockfile only. Bumping the tabletop version means updating `packages/addon/package.json` as well.

Only the addon (and the packages derived from its template build) needs Tabletop; `@piano/core`, `@piano/server`, `@piano/web` build without it.

The installed Tabletop package declares itself private and contains no license declaration or license file; no license is inferred here. Its bundled `@begame/trace` and `@begame/trace-spec` packages include their own MIT license files inside the archive.

# Vendored SAPI-Pro dependency (local DDUI development)

`sapi-pro-dev.tgz` is a **local development build** of [SAPI-Pro](../SAPI-Pro) used while DDUI is
still being validated against this addon. It is produced from a checkout of the SAPI-Pro `dev`
branch and is not a published npm version (`vendor/*.tgz` is ignored, like the Tabletop tarball).

A fresh clone restores the link with:

```bash
git clone https://github.com/XiaoYangx666/SAPI-Pro.git ../SAPI-Pro
npm run vendor:sapipro        # builds SAPI-Pro stable, packs vendor/sapi-pro-dev.tgz, npm install
```

`tools/sync-sapipro.mjs` also accepts an explicit checkout path:
`node tools/sync-sapipro.mjs path/to/SAPI-Pro`. Re-run it after every SAPI-Pro change; add
`--no-install` to only refresh the tarball.

Because `packages/addon/package.json` points at a tarball, `npm install` pins the archive hash in
the lockfile. Repacking changes that hash, so refresh the lockfile (`npm install`) together with
the tarball. When SAPI-Pro publishes a release that contains DDUI, replace this with a normal
semver dependency.
