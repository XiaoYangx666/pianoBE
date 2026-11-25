# Vendored Tabletop dependency

`begame-tabletop-0.1.16.tgz` is a private dependency of `@piano/addon`. It is **not** distributed with this repository (`vendor/*.tgz` is ignored) and is not part of the git history. Its source lives in the private repository `https://github.com/ykxyx666/tabletop.git`.

A fresh clone needs the private tarball to build the addon. The lockfile pins the archive built from Tabletop commit `7082e443b67436d5a5e04eb8ad2215d835ee1e29`, which includes `createMinecraftSeats` and its mount HUD option.

```bash
git clone git@github.com:ykxyx666/tabletop.git ../tabletop
git -C ../tabletop checkout 7082e443b67436d5a5e04eb8ad2215d835ee1e29
npm run vendor:tabletop   # runs `npm pack` in ../tabletop (its prepack builds first)
npm install
```

`tools/vendor/pack-tabletop.mjs` also accepts an explicit checkout path: `node tools/vendor/pack-tabletop.mjs path/to/tabletop`. The tarball SHA-512 is pinned in the root `package-lock.json`; if a repack changes it, refresh the lockfile with `npm install` and commit the lockfile only. Bumping the tabletop version means updating `packages/addon/package.json` as well.

Only the addon (and the packages derived from its template build) needs Tabletop; `@piano/core`, `@piano/server`, `@piano/web` build without it.

The installed Tabletop package declares itself private and contains no license declaration or license file; no license is inferred here. Its bundled `@begame/trace` and `@begame/trace-spec` packages include their own MIT license files inside the archive.

# SAPI-Pro dependency

`sapi-pro` is a normal npm dependency now (`0.4.4-stable` and later include DDUI). A fresh clone only needs `npm install`; there is no local tarball to rebuild. Pin the published version in `packages/addon/package.json` and keep the manifest dependency in both `bepack.config.ts` and `bepack.server.config.ts` on the same version.

`sapi-pro@0.4.4-stable` requires `@minecraft/server ^2.11.0` and `@minecraft/server-ui ^2.3.0`, so the client manifest, the root overrides and the addon dependency all track those versions.
