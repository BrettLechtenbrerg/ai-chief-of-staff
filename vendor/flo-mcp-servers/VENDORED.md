# Vendored Flo MCP runtime

This directory packages the compiled Gmail, Calendar, Docs/Drive, and Bookmarks MCP servers for use without a system Node installation.

## Provenance

- Upstream project: the private/local Flo checkout supplied to `refresh-vendor.sh` (default `~/flo-assistant`).
- The original import did **not** record an upstream commit. The current compiled baseline is anchored by the ACOS git/release commit and package checksums, but its source-origin provenance is incomplete. Any future refresh must record the upstream repository URL and exact commit before those changed bundles can ship.
- Runtime dependencies are locked by this directory's `package-lock.json` and installed with `npm ci --omit=dev --ignore-scripts`.
- The tracked `shared/` package is an ACOS-maintained security fork; it is not copied automatically from upstream.

## ACOS security deltas

- OAuth token and credential paths honor `FLO_TOKEN_PATH` and `FLO_CREDENTIALS_PATH`, keeping them under ACOS user data.
- Proposal storage honors `FLO_PROPOSALS_PATH`, uses WAL, and hardens its directory/database/sidecars to `0700`/`0600` where the platform supports POSIX modes.
- `connect-tools-ipc.ts` supplies these private paths when it launches the bundled servers.
- `install-vendor-deps.cjs` and `refresh-vendor.sh` fail closed if the tracked OAuth or proposal-storage patches disappear.

## Refresh procedure

1. Build the four server outputs in a reviewed upstream checkout.
2. Record its repository URL and commit in this file.
3. Run `./refresh-vendor.sh /absolute/path/to/flo-assistant`.
4. Review every changed compiled server file. The script only reports differences in upstream shared output; port those changes manually without dropping ACOS security patches.
5. Update exact dependency versions and `package-lock.json` deliberately, then run the normal release gates at commit time.
