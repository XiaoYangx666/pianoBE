# SAPI-Pro dependency

`sapi-pro` is a normal npm dependency now (`0.4.4-stable` and later include DDUI). A fresh clone only needs `npm install`; there is no local tarball to rebuild. Pin the published version in `packages/addon/package.json` and keep the manifest dependency in both `bepack.config.ts` and `bepack.server.config.ts` on the same version.

`sapi-pro@0.4.4-stable` requires `@minecraft/server ^2.11.0` and `@minecraft/server-ui ^2.3.0`, so the client manifest, the root overrides and the addon dependency all track those versions.
