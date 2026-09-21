# Quorum frontend

React, Vite, TypeScript, RainbowKit, wagmi and viem frontend for the attested Quorum deployment. The repository-root `dist/` is the complete static website, including local JavaScript/CSS and implementation-derived ABIs. Serve it over HTTPS (or localhost), not `file://`. No server, private credentials, WalletConnect project ID or external fonts are required.

## Install, build and check

Use Node 22.12+ (worker used Node 24.21.0).

```sh
cd web
npm ci --cache /tmp/quorum-npm-cache
npm run typecheck
npm run build
npm run verify:export
npm run preview
# In another terminal, from web/:
npx playwright install chromium
npm test
```

`npm run dev` starts Vite development hosting. Run the build first to prepare its public configuration and ABIs. Browser tests run against the production export, start a preview server automatically and mock wallet/RPC requests; they never submit real transactions. Chromium needs the standard Playwright Linux system libraries. On this restricted worker, temporary extracted libraries and browser downloads were used outside the submission; details are in `docs/frontend-validation.md`.

## Configuration and provenance

`deployment-handoff.json` is the preserved public deployment input. `scripts/export.mjs prepare` reads each ABI with `git show <sourceCommit>:docs/abi/<Contract>.json`, recursively sorts JSON object keys (preserving array order), serializes without whitespace, computes Keccak-256, and rejects a mismatch against the handoff. The pinned commit must be present in Git. It never rebuilds or edits deployed Solidity.

The build copies verified raw ABI arrays to the export. Its final step emits `dist/imd-deployment.json` with the exact handoff identifiers and contract set, and SHA-256 hashes of every other exported file. `npm run verify:export` independently checks the inventory, hashes, ABI binding and size limits. Rebuild after any source/export modification; never hand-edit the asset inventory.

At runtime `src/config.ts` fetches that same relative `imd-deployment.json`, loads the referenced ABIs and verifies their canonical hashes. No independent address, chain ID or ABI map is bundled. That module also centralizes the public RPC and explorer URLs. Reads use PublicNode; failure disables actions and offers refresh. Wallet transport is used only for connecting and signing, with injected browser wallets and RainbowKit account UI. WalletConnect/mobile QR requires separate project configuration and is not enabled.

Before enabling actions the app checks the configured RPC chain ID, nonempty code at every handoff address and the voting contract's token binding. State refreshes every 20 seconds, on account/proposal changes, manually, and after receipts. Transactions are simulated first, signed by the visitor, and followed to a successful receipt; failures/rejections remain visible with submitted transaction explorer links. Publication checks are separate from these worker checks.

## Voting

Anyone can open a proposal by hashing a trimmed UTF-8 title. Only that hash is stored; share the original title off-chain. Dates are entered in local time, converted to Unix seconds, and checked against the latest block timestamp. Each phase is at least one hour, total duration at most 90 days; allow extra time for transaction inclusion.

Select a proposal by ID. The app reads deadlines, tallies, the connected account's ballot, token decimals, balance and allowance. Tallies are provisional until the reveal deadline. There is no deployed swap interface in this handoff, so the application implements the approved voting workflow and direct QRM transfer.

Commit requires an explicit exact-stake approval and a recovery export. The salt uses `crypto.getRandomValues`; commitment encoding is exactly `keccak256(abi.encode(uint256 proposalId, address voter, bool choice, bytes32 salt))`. Browser storage is namespaced by chain, voting contract, wallet and proposal. The downloaded JSON also carries that namespace; paste it into recovery when changing browser or gateway origin. Keep it private and backed up. Local storage is not encrypted. Export initiation cannot prove that a user retained the file. Reveal verifies the recovered commitment matches the on-chain ballot. Reclaim works after the deadline even for unrevealed votes. No secret is deleted automatically.

Approval and commit are separate transactions. If commit fails, the approval may remain; the next exact-stake approval can replace it. Wallet confirmations show exact transaction arguments. General ERC-20 delegated `transferFrom` is used by the voting contract during commit, rather than exposed as a separate end-user form.

## Scope and packaging

Only `web/**`, `dist/**`, and frontend documentation/screenshots under `docs/**` are added. The explicitly budgeted ignore change is `web/.gitignore` alone: it excludes node_modules at all nesting levels, npm/cache directories, and Playwright output. No root configuration, contracts, submodules, caches, dependency archives or node_modules are included. The publisher should commit source, lockfile, export and evidence together and host the existing export. Publication, CIDs and live funded transactions are outside this worker validation.
