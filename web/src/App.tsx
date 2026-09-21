import { useCallback, useEffect, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  encodeAbiParameters,
  formatUnits,
  parseUnits,
  keccak256,
  toBytes,
  isAddress,
  type Hex,
} from "viem";
import { network, type Runtime } from "./config";
type Secret = { choice: boolean; salt: Hex };
const errorText = (e: any) => e.shortMessage || e.message || String(e);
export function App({ runtime: { d, client } }: { runtime: Runtime }) {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: wallet } = useWalletClient();
  const token = d.contracts.find((c) => c.name === "Quorum")!;
  const vote = d.contracts.find((c) => c.name === "CommitRevealVote")!;
  const [verified, setVerified] = useState(false),
    [status, setStatus] = useState(""),
    [readStatus, setReadStatus] = useState(
      "Checking network and deployed contracts…",
    ),
    [tx, setTx] = useState<Hex>(),
    [busy, setBusy] = useState(false);
  const [id, setId] = useState("1"),
    [count, setCount] = useState(0n),
    [proposal, setProposal] = useState<any>(),
    [ballot, setBallot] = useState<any>(),
    [balance, setBalance] = useState(0n),
    [allowance, setAllowance] = useState(0n),
    [decimals, setDecimals] = useState(18),
    [now, setNow] = useState(0),
    [fresh, setFresh] = useState(false);
  const [title, setTitle] = useState(""),
    [commitEnd, setCommitEnd] = useState(""),
    [revealEnd, setRevealEnd] = useState(""),
    [amount, setAmount] = useState(""),
    [choice, setChoice] = useState(true),
    [secret, setSecret] = useState<Secret>(),
    [backup, setBackup] = useState(false),
    [restore, setRestore] = useState(""),
    [recipient, setRecipient] = useState(""),
    [transferAmount, setTransferAmount] = useState("");
  const key = `quorum:${d.chainId}:${vote.address}:${address?.toLowerCase()}:${id}`;
  useEffect(() => {
    setSecret(undefined);
    setBackup(false);
    try {
      const s = localStorage.getItem(key);
      if (s) {
        const parsed = JSON.parse(s);
        setSecret(parsed);
        setChoice(parsed.choice);
      }
    } catch {
      setStatus(
        "Local storage unavailable. Export a recovery secret before committing.",
      );
    }
  }, [key]);
  const read = useCallback(async () => {
    setFresh(false);
    try {
      const rpcChain = await client.getChainId();
      if (rpcChain !== d.chainId)
        throw Error("RPC chain does not match deployment");
      const codes = await Promise.all(
        d.contracts.map((c) => client.getCode({ address: c.address })),
      );
      if (codes.some((c) => !c || c === "0x"))
        throw Error("Deployed contract code missing");
      const r = (c: typeof token, functionName: string, args: any[] = []) =>
        client.readContract({
          address: c.address,
          abi: c.abi!,
          functionName,
          args,
        });
      const [n, dec, block, binding] = await Promise.all([
        r(vote, "proposalCount"),
        r(token, "decimals"),
        client.getBlock(),
        r(vote, "token"),
      ]);
      if (String(binding).toLowerCase() !== token.address.toLowerCase())
        throw Error("Voting token binding mismatch");
      setCount(n as bigint);
      setDecimals(Number(dec));
      setNow(Number(block.timestamp));
      if (address) {
        const [b, a] = await Promise.all([
          r(token, "balanceOf", [address]),
          r(token, "allowance", [address, vote.address]),
        ]);
        setBalance(b as bigint);
        setAllowance(a as bigint);
      }
      if (
        /^\d+$/.test(id) &&
        BigInt(id) > 0n &&
        BigInt(id) <= BigInt(n as bigint)
      ) {
        setProposal(await r(vote, "proposals", [BigInt(id)]));
        setBallot(
          address ? await r(vote, "ballots", [BigInt(id), address]) : undefined,
        );
      } else {
        setProposal(undefined);
        setBallot(undefined);
      }
      setVerified(true);
      setFresh(true);
      setReadStatus("Live state updated.");
    } catch (e) {
      setVerified(false);
      setReadStatus(errorText(e));
    }
  }, [address, id, client, d, token, vote]);
  useEffect(() => {
    void read();
    const t = setInterval(() => void read(), 20000);
    return () => clearInterval(t);
  }, [read]);
  let units = 0n;
  try {
    if (!new RegExp("^\\d+(?:\\.\\d{1," + decimals + "})?$").test(amount))
      throw Error("Invalid amount");
    units = parseUnits(amount, decimals);
  } catch {
    /* input invalid */
  }
  const ready =
    verified && fresh && isConnected && chainId === d.chainId && !busy;
  const phase = !proposal
    ? "No proposal"
    : now < Number(proposal[1])
      ? "Commit"
      : now < Number(proposal[2])
        ? "Reveal"
        : "Final";
  const hasBallot = ballot && ballot[1] > 0n;
  async function send(c: typeof token, fn: string, args: any[], label: string) {
    if (!ready || !wallet) return;
    setBusy(true);
    setTx(undefined);
    setStatus(`Confirm in your wallet: ${label}`);
    try {
      const { request } = await client.simulateContract({
        address: c.address,
        abi: c.abi!,
        functionName: fn,
        args,
        account: address,
      });
      const hash = await wallet.writeContract(request as any);
      setTx(hash);
      setStatus("Transaction submitted. Waiting for confirmation…");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw Error("Transaction reverted");
      await read();
      setStatus(`${label} confirmed.`);
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function generate() {
    const salt = ("0x" +
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("")) as Hex;
    const s = { choice, salt };
    setSecret(s);
    setBackup(false);
    try {
      localStorage.setItem(key, JSON.stringify(s));
      setStatus("Secret saved in this browser. Export a recovery copy.");
    } catch {
      setStatus("Storage failed. Export your secret now.");
    }
  }
  function exportSecret() {
    if (!secret) return;
    const b = new Blob([JSON.stringify({ key, ...secret }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quorum-${id}-secret.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackup(true);
  }
  function recover() {
    try {
      const s = JSON.parse(restore);
      if (
        s.key !== key ||
        typeof s.choice !== "boolean" ||
        !/^0x[0-9a-fA-F]{64}$/.test(s.salt)
      )
        throw Error(
          "Secret must match this chain, contract, account and proposal.",
        );
      setSecret(s);
      setChoice(s.choice);
      setBackup(true);
      try {
        localStorage.setItem(key, JSON.stringify(s));
      } catch {}
      setStatus("Recovery secret loaded.");
    } catch (e) {
      setStatus(errorText(e));
    }
  }
  function open() {
    const c = Math.floor(new Date(commitEnd).getTime() / 1000),
      r = Math.floor(new Date(revealEnd).getTime() / 1000);
    if (
      !title.trim() ||
      !Number.isFinite(c) ||
      !Number.isFinite(r) ||
      c < now + 3600 ||
      r < c + 3600 ||
      r > now + 90 * 86400
    ) {
      setStatus(
        "Enter a title and deadlines: each phase at least 1 hour; total at most 90 days. Allow time for confirmation.",
      );
      return;
    }
    void send(
      vote,
      "openProposal",
      [keccak256(toBytes(title.trim())), BigInt(c), BigInt(r)],
      "Open proposal",
    );
  }
  const commitment =
    secret && address && /^\d+$/.test(id)
      ? keccak256(
          encodeAbiParameters(
            [
              { type: "uint256" },
              { type: "address" },
              { type: "bool" },
              { type: "bytes32" },
            ],
            [BigInt(id), address, secret.choice, secret.salt],
          ),
        )
      : undefined;
  return (
    <>
      <header>
        <a className="brand" href="#">
          ◈ <span>quorum</span>
        </a>
        <div className="wallet">
          <span className="network">● Sepolia</span>
          {isConnected ? (
            <>
              <ConnectButton showBalance={false} />
              <button className="quiet" onClick={() => disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={async () => {
                if (!(await connectors[0]?.getProvider())) {
                  setStatus(
                    "No browser wallet found. Install an Ethereum wallet and reload.",
                  );
                  return;
                }
                connect(
                  { connector: connectors[0] },
                  { onError: (e) => setStatus(errorText(e)) },
                );
              }}
            >
              Connect wallet
            </button>
          )}
        </div>
      </header>
      <main>
        <section className="hero">
          <p className="eyebrow">A COLLECTIVE DECISION, PRIVATELY COMMITTED</p>
          <h1>
            Your voice.
            <br />
            <em>Your conviction.</em>
          </h1>
          <p>
            Lock QRM to commit your vote. Reveal your choice when the time
            comes. Reclaim your tokens when the decision is final.
          </p>
          <div className="steps">
            <span>
              01 <b>Commit</b>
            </span>
            <span>
              02 <b>Reveal</b>
            </span>
            <span>
              03 <b>Reclaim</b>
            </span>
          </div>
        </section>
        <div className="notice" role="status" aria-live="polite">
          {status || readStatus} {status && !verified && readStatus}{" "}
          {tx && (
            <a
              href={`${network.explorer}/tx/${tx}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          )}
        </div>
        {!isConnected && (
          <p className="muted">
            Connect a browser wallet to see your QRM balance and vote. No
            wallet? Install an Ethereum browser wallet, then reload. Sepolia ETH
            is needed for gas.
          </p>
        )}
        {isConnected && chainId !== d.chainId && (
          <div className="notice">
            Wrong network.{" "}
            <button
              onClick={() =>
                switchChain(
                  { chainId: d.chainId },
                  { onError: (e) => setStatus(errorText(e)) },
                )
              }
            >
              Switch to Sepolia
            </button>
          </div>
        )}
        <section className="stats">
          <div>
            <small>PROPOSALS</small>
            <strong>{count.toString()}</strong>
          </div>
          <div>
            <small>YOUR BALANCE</small>
            <strong>
              {address ? formatUnits(balance, decimals) : "—"}{" "}
              <small>QRM</small>
            </strong>
          </div>
          <div>
            <small>APPROVED TO LOCK</small>
            <strong>
              {address ? formatUnits(allowance, decimals) : "—"}{" "}
              <small>QRM</small>
            </strong>
          </div>
        </section>
        <div className="grid">
          <section className="card">
            <div className="cardhead">
              <h2>The voting room</h2>
              <span className="pill">{phase}</span>
            </div>
            <label>
              Proposal ID
              <input
                aria-label="Proposal ID"
                type="number"
                min="1"
                value={id}
                onChange={(e) => {
                  setFresh(false);
                  setProposal(undefined);
                  setBallot(undefined);
                  setId(e.target.value);
                }}
              />
            </label>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => void read()}
            >
              Refresh live state
            </button>
            {proposal ? (
              <>
                <p className="hash">
                  Title hash <code>{proposal[0]}</code>
                </p>
                <p className="muted">
                  Commit until{" "}
                  {new Date(Number(proposal[1]) * 1000).toLocaleString()}
                  <br />
                  Reveal until{" "}
                  {new Date(Number(proposal[2]) * 1000).toLocaleString()}
                </p>
                <div className="tallies">
                  <div>
                    <small>FOR</small>
                    <strong>{formatUnits(proposal[4], decimals)} QRM</strong>
                  </div>
                  <div>
                    <small>AGAINST</small>
                    <strong>{formatUnits(proposal[3], decimals)} QRM</strong>
                  </div>
                </div>
                <p className="muted">
                  {phase === "Final"
                    ? "Final totals"
                    : "Provisional totals · hidden votes are not counted"}{" "}
                  · 1 QRM = 1 vote weight
                </p>
                {hasBallot && (
                  <p>
                    Your locked stake: {formatUnits(ballot[1], decimals)} QRM ·{" "}
                    {ballot[2] ? "Revealed" : "Unrevealed"} ·{" "}
                    {ballot[3] ? "Reclaimed" : "Not reclaimed"}
                  </p>
                )}
              </>
            ) : (
              <p className="muted">
                Select an existing proposal, or open the first one.
              </p>
            )}
            <hr />
            <h3>01 / Commit your vote</h3>
            <p className="muted">
              Approval permits only this stake. Commit locks tokens until the
              reveal deadline. Keep the secret private until reveal.
            </p>
            <label>
              Stake · QRM
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
              />
            </label>
            <label>
              Your choice
              <select
                value={choice ? "for" : "against"}
                disabled={!!secret || hasBallot}
                onChange={(e) => setChoice(e.target.value === "for")}
              >
                <option value="for">For</option>
                <option value="against">Against</option>
              </select>
            </label>
            <div className="actions">
              <button
                className="quiet"
                disabled={!ready || phase !== "Commit" || hasBallot || !!secret}
                onClick={generate}
              >
                Generate secret
              </button>
              <button
                className="quiet"
                disabled={!secret}
                onClick={exportSecret}
              >
                Export recovery secret
              </button>
            </div>
            {secret && (
              <p className="muted">
                Secret ready for {secret.choice ? "For" : "Against"}.{" "}
                {backup
                  ? "Recovery exported / restored."
                  : "Export recovery before committing. Losing it prevents reveal."}
              </p>
            )}
            <div className="actions">
              <button
                disabled={
                  !ready ||
                  phase !== "Commit" ||
                  hasBallot ||
                  units <= 0n ||
                  units > balance
                }
                onClick={() =>
                  void send(
                    token,
                    "approve",
                    [vote.address, units],
                    "Approve QRM stake",
                  )
                }
              >
                Approve QRM
              </button>
              <button
                disabled={
                  !ready ||
                  phase !== "Commit" ||
                  hasBallot ||
                  !commitment ||
                  !backup ||
                  units <= 0n ||
                  units > balance ||
                  allowance < units
                }
                onClick={() =>
                  void send(
                    vote,
                    "commitVote",
                    [BigInt(id), commitment, units],
                    "Commit vote and lock QRM",
                  )
                }
              >
                Commit vote
              </button>
            </div>
            <hr />
            <h3>02 / Reveal your choice</h3>
            <p className="muted">
              Your saved choice and salt must match the on-chain commitment.
            </p>
            <details>
              <summary>Restore a recovery secret</summary>
              <label>
                Recovery JSON
                <textarea
                  value={restore}
                  onChange={(e) => setRestore(e.target.value)}
                />
              </label>
              <button className="quiet" onClick={recover}>
                Restore secret
              </button>
            </details>
            <button
              disabled={
                !ready ||
                phase !== "Reveal" ||
                !hasBallot ||
                ballot[2] ||
                !secret ||
                commitment !== ballot[0]
              }
              onClick={() =>
                void send(
                  vote,
                  "revealVote",
                  [BigInt(id), secret!.choice, secret!.salt],
                  "Reveal vote",
                )
              }
            >
              Reveal vote
            </button>
            <hr />
            <h3>03 / Reclaim your stake</h3>
            <p className="muted">
              After the reveal deadline, reclaim all locked QRM, even if you did
              not reveal.
            </p>
            <button
              disabled={!ready || phase !== "Final" || !hasBallot || ballot[3]}
              onClick={() =>
                void send(vote, "reclaim", [BigInt(id)], "Reclaim QRM")
              }
            >
              Reclaim tokens
            </button>
          </section>
          <aside>
            <section className="card">
              <p className="eyebrow">START A CONVERSATION</p>
              <h2>Open a proposal</h2>
              <p className="muted">
                Anyone can propose. Only the title hash is stored on-chain;
                share the original title with voters.
              </p>
              <label>
                Proposal title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What should we decide?"
                />
              </label>
              {title && (
                <p className="hash">
                  <code>{keccak256(toBytes(title.trim()))}</code>
                </p>
              )}
              <label>
                Commit deadline · local time
                <input
                  type="datetime-local"
                  value={commitEnd}
                  onChange={(e) => setCommitEnd(e.target.value)}
                />
              </label>
              <label>
                Reveal deadline · local time
                <input
                  type="datetime-local"
                  value={revealEnd}
                  onChange={(e) => setRevealEnd(e.target.value)}
                />
              </label>
              <p className="muted">
                Each phase needs at least one hour. The entire vote must finish
                within 90 days.
              </p>
              <button disabled={!ready} onClick={open}>
                Open proposal ↗
              </button>
            </section>
            <section className="card subtle">
              <h2>Send QRM</h2>
              <p className="muted">
                Transfer tokens to another address. Transfers are irreversible.
              </p>
              <label>
                Recipient
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <label>
                Amount · QRM
                <input
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <button
                disabled={!ready}
                onClick={() => {
                  try {
                    const n = parseUnits(transferAmount, decimals);
                    if (!isAddress(recipient) || n <= 0n || n > balance)
                      throw Error(
                        "Enter a valid recipient and an amount within your balance.",
                      );
                    void send(
                      token,
                      "transfer",
                      [recipient, n],
                      "Transfer QRM",
                    );
                  } catch (e) {
                    setStatus(errorText(e));
                  }
                }}
              >
                Transfer QRM
              </button>
            </section>
          </aside>
        </div>
        <footer>
          <div className="brand">◈ quorum</div>
          <p>Fixed supply. Open participation. No protocol fee.</p>
          {d.contracts.map((c) => (
            <a
              key={c.name}
              href={`${network.explorer}/address/${c.address}`}
              target="_blank"
              rel="noreferrer"
            >
              {c.name} <span className="hash">{c.address}</span> ↗
            </a>
          ))}
          <p className="muted">
            Deployment {d.launchId} · Source {d.sourceCommit.slice(0, 12)}
            <br />
            Public RPC: {network.rpc}
          </p>
        </footer>
      </main>
    </>
  );
}
