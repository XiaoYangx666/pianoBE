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
