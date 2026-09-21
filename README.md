# Quorum contracts

Quorum is a token-weighted commit/reveal voting protocol intended for the IdentityMD Sepolia project launch.

## Contracts

- `Quorum` is a conventional fixed-supply ERC-20: 18 decimals, symbol `QRM`, and exactly 1,000,000,000 QRM minted to its deployer. It has no owner, mint, pause, fee, upgrade, or administrative path.
- `CommitRevealVote` accepts the QRM address as its sole constructor argument. Anyone can open a proposal, commit a binary vote while locking a positive amount of QRM, reveal during the reveal window, and reclaim the entire locked amount once the window ends. It has no owner, fee, or administrative powers.

Commitments are `keccak256(abi.encode(choice, salt))`, where `choice` is a Solidity `bool` and `salt` is a `bytes32`. Each address gets one commitment per proposal. The commit interval ends at `commitDeadline`; reveal is allowed from `commitDeadline` (inclusive) to `revealDeadline` (exclusive); reclaim begins at `revealDeadline`. Only revealed weight enters the immutable final totals. Non-revealers still recover their stake after the deadline, preventing permanent custody from a lost salt. Proposals are independent, so a voter must hold and lock separate tokens for overlapping proposals.

## Deployment assumptions

The intended chain is Sepolia (chain ID 11155111), deployed through `ProjectFactory`. Deploy `Quorum` first with no arguments, then `CommitRevealVote` with the deployed token address (`$token`). Constructors are nonpayable and make no external calls. The application identifier is `CommitRevealVote`; the token name and symbol are `Quorum` and `QRM`. Compiler settings are Solidity 0.8.26, optimizer enabled with 200 runs, and `bytecode_hash = "none"`. This source-producing assignment intentionally does not create `launch.json`; the independent manifest assignment owns it.

The deployer/factory initially receives the complete supply and is operationally responsible for launch distribution and liquidity. This repository does not broadcast, handle keys, choose proposal deadlines, retain salts, or run an oracle. Users and frontends must generate unpredictable salts locally, preserve them until reveal, approve QRM before commit, verify chain and contract addresses from the admitted deployment artifact, and submit transactions before deadline boundaries with sufficient confirmation margin. Timestamps are validator-influenced within normal consensus bounds, so deadlines should not be narrowly spaced.

The voting contract assumes the configured token implements standard `transfer` and `transferFrom` semantics and returns `true`; fee-on-transfer or rebasing tokens are unsupported. QRM satisfies that assumption. Checks-effects-interactions plus a reentrancy lock protect both custody calls, and failed/false-returning transfers roll back ballot state. Tokens sent directly to the voting contract are not attributable to a ballot and cannot be recovered.

## Build and verification

Run offline after Solidity 0.8.26 has been installed in Foundry's normal compiler cache:

```sh
forge build --offline
forge test --offline
forge fmt --check
```

The suite covers fixed supply and ERC-20 transfers, the full commit/reveal/reclaim flow, balance conservation, non-reveal refunds, invalid deadlines and amounts, unauthorized/missing ballots, duplicate actions, exact timing boundaries, invalid reveals, insufficient approval/balance rollback, false-returning tokens, and malicious-token reentrancy. ABI exports are committed in `docs/abi/`.

Passing tests are not a security audit. The required independent adversarial contract/manifest review must occur before admission or deployment, and release services—not contributors—are responsible for source publication, attestation, admission, deployment, and later frontend startup.

