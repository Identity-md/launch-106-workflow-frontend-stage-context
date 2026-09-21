# Frontend worker validation

Validated on 2026-09-21. These are worker-reported checks, not independent certification or publication checks.

- TypeScript: `npm run typecheck` passes.
- Production: `npm run build` passes. Relative Vite base `./`; no server routes or remote runtime assets are required. Rollup reports harmless third-party PURE-comment annotation warnings.
- Export: `npm run verify:export` passes. 74 exported assets (manifest excluded), approximately 2.4 MB, all SHA-256 inventory entries checked; exact handoff identifiers and both canonical ABI Keccak hashes match. ABIs were obtained from `docs/abi/` at pinned commit `891f2577e0a8ea85f51b518eec3de468d143da62` using `git show`.
- Chromium: 9 Playwright tests pass against the production export. Tests cover opening a proposal and invalid deadlines; exact-stake approval; cryptographic commitment; recovery export and invalid/valid import; reveal with commitment assertion; final tallies; reclaim; direct token transfer; rejected signing and retry; disconnected and missing-wallet states; wrong-chain blocking and switching; RPC failure; missing contract code; tampered ABI rejection; relative gateway-subpath hosting; and mobile/desktop layout.
- Viewports: 390 × 1000 and 1440 × 1000. No horizontal overflow or uncaught page errors. Screenshots `quorum-390.png` and `quorum-1440.png` were visually inspected: controls, labels, card layout and wrapped addresses render correctly. Gateway-subpath test also checks HTTP response failures.
- Read-only live RPC: PublicNode returned `eth_chainId = 0xaa36a7` (11155111). `eth_getCode` returned 1269 bytes for Quorum and 2845 bytes for CommitRevealVote, at the handoff addresses. No transactions were broadcast. This is a point-in-time check, not a guarantee of future endpoint availability.

The browser suite uses an injected EIP-1193 mock and ABI-encoded RPC results. It verifies outgoing action names and parameters, updates mocked balances/ballots/tallies, and tests real frontend rendering and state handling. It does not prove deployed Solidity behavior, real wallet extension behavior, real transaction inclusion, real gas costs, mainnet use, WalletConnect, or live funded end-to-end voting. No IPFS publication, named-site checks, CID checks or independent final review were performed by this worker.

Initial checks found an invalid CSS import and an asynchronous read overwriting wallet error messages; both were corrected. Mock-wallet rejection handling was corrected to distinguish EIP-1193 rejection (4001) from unsupported methods (4200). Final checks use the repaired implementation.

On this worker, the normal npm cache is read-only, so installation used `/tmp/quorum-npm-cache`. Playwright Chromium was installed in `/tmp/quorum-browsers`; required shared libraries were available/extracted under `/tmp`. The test command was:

```sh
LD_LIBRARY_PATH=/tmp/highroll-libs/usr/lib/x86_64-linux-gnu:/tmp/quorum-libs/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=/tmp/quorum-browsers npm test --prefix web
```

These temporary browser/dependency files are excluded from the submission. The only ignore-file change is the explicitly budgeted `web/.gitignore`; it excludes dependency/cache/test-output directories. No root build configuration, Solidity source, protected paths or submodules are changed.

The environment mounts `.git` read-only. `git add` was attempted and failed creating `.git/index.lock` with `Read-only file system`; the worker cannot commit in this checkout. All requested source, lockfile, final export and evidence are present for the publisher's commit. A scratch-only clone is used to measure the prospective complete Git bundle without modifying this checkout's metadata.

Final production recheck: typecheck, build, export verification and all 9 browser tests pass (16.2 seconds for the browser suite). The final asset inventory totals 2,404,422 bytes excluding the manifest. The prospective bundle built in a depth-one scratch clone, containing the pinned source tree plus the complete frontend submission, is below 1,500,000 bytes (limit: 8,388,608). A full-history clone was unavailable because the worker's partial clone lacks some historical objects; this measurement includes the complete submitted tree and pinned base, not unavailable older history. New deliverable files total approximately 3.18 MB before Git compression. Path audit found no out-of-scope files, dependency/cache archives or protected-source changes.
