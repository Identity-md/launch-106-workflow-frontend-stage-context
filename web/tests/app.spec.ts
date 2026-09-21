import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeFunctionResult,
  keccak256,
  encodeAbiParameters,
  type Hex,
} from "viem";
const manifest = JSON.parse(
  readFileSync("../dist/imd-deployment.json", "utf8"),
);
const abis = Object.fromEntries(
  manifest.contracts.map((c: any) => [
    c.address.toLowerCase(),
    JSON.parse(readFileSync("../dist/" + c.abiPath, "utf8")),
  ]),
);
const account = "0x1111111111111111111111111111111111111111";
const zero = "0x" + "00".repeat(32),
  hash = "0x" + "ab".repeat(32);
async function setup(
  page: any,
  options: { wrong?: boolean; missing?: boolean; rpcFail?: boolean; emptyCode?: boolean; path?: string } = {},
) {
  const s: any = {
    now: 1800000000,
    commitEnd: 1800007200,
    revealEnd: 1800014400,
    count: 1n,
    balance: 100n * 10n ** 18n,
    allowance: 0n,
    commitment: zero,
    amount: 0n,
    revealed: false,
    reclaimed: false,
    forVotes: 0n,
    againstVotes: 0n,
    actions: [],
    reject: false,
  };
  await page.exposeFunction(
    "mockWalletRequest",
    async ({ method, params }: any) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [account];
      if (method === "eth_chainId")
        return "0x" + (options.wrong ? 1 : manifest.chainId).toString(16);
      if (method === "wallet_switchEthereumChain") {
        options.wrong = false;
        return null;
      }
      if (method === "eth_sendTransaction") {
        if (s.reject) throw Error("User rejected the request");
        const t = params[0],
          decoded = decodeFunctionData({
            abi: abis[t.to.toLowerCase()],
            data: t.data,
          }),
          args = decoded.args as any[];
        s.actions.push(decoded.functionName);
        if (decoded.functionName === "approve") s.allowance = args[1];
        if (decoded.functionName === "openProposal") s.count++;
        if (decoded.functionName === "commitVote") {
          s.commitment = args[1];
          s.amount = args[2];
          s.balance -= args[2];
          s.allowance -= args[2];
        }
        if (decoded.functionName === "revealVote") {
          expect(
            keccak256(
              encodeAbiParameters(
                [
                  { type: "uint256" },
                  { type: "address" },
                  { type: "bool" },
                  { type: "bytes32" },
                ],
                [args[0], account, args[1], args[2]],
              ),
            ),
          ).toBe(s.commitment);
          s.revealed = true;
          s[args[1] ? "forVotes" : "againstVotes"] += s.amount;
        }
        if (decoded.functionName === "reclaim") {
          s.reclaimed = true;
          s.balance += s.amount;
        }
        if (decoded.functionName === "transfer") s.balance -= args[1];
        return hash;
      }
      if (method === "wallet_getCapabilities") return {};
      throw Error("Unsupported wallet request " + method);
    },
  );
  if (!options.missing)
    await page.addInitScript(() => {
      const listeners: Record<string, Function[]> = {};
      (window as any).ethereum = {
        isMetaMask: true,
        on: (n: string, fn: Function) => {
          (listeners[n] ??= []).push(fn);
        },
        removeListener: () => {},
        request: async (r: any) => {
          let result;
          try {
            result = await (window as any).mockWalletRequest(r);
          } catch (e: any) {
            throw Object.assign(new Error(e.message), { code: e.message.includes("User rejected") ? 4001 : 4200 });
          }
          if (r.method === "wallet_switchEthereumChain")
            for (const f of listeners.chainChanged || [])
              f(r.params[0].chainId);
          return result;
        },
      };
    });
  await page.route(
    "https://ethereum-sepolia-rpc.publicnode.com/**",
    async (route: any) => {
      if (options.rpcFail)
        return route.fulfill({ status: 503, body: "unavailable" });
      const request = route.request().postDataJSON();
      const respond = (q: any) => {
        let result: any;
        switch (q.method) {
          case "eth_chainId":
            result = "0x" + manifest.chainId.toString(16);
            break;
          case "eth_getCode":
            result = options.emptyCode ? "0x" : "0x60016000";
            break;
          case "eth_blockNumber":
            result = "0x100";
            break;
          case "eth_getBalance":
            result = "0xde0b6b3a7640000";
            break;
          case "eth_getBlockByNumber":
            result = {
              number: "0x100",
              hash,
              parentHash: zero,
              timestamp: "0x" + s.now.toString(16),
              transactions: [],
              gasLimit: "0x1c9c380",
              gasUsed: "0x0",
              baseFeePerGas: "0x1",
              difficulty: "0x0",
              extraData: "0x",
              miner: account,
              nonce: "0x0000000000000000",
              size: "0x1",
              sha3Uncles: zero,
              receiptsRoot: zero,
              stateRoot: zero,
              transactionsRoot: zero,
              logsBloom: "0x" + "00".repeat(256),
            };
            break;
          case "eth_getTransactionReceipt":
            result = {
              transactionHash: hash,
              transactionIndex: "0x0",
              blockHash: hash,
              blockNumber: "0x100",
              from: account,
              to: manifest.contracts[1].address,
              cumulativeGasUsed: "0x5208",
              gasUsed: "0x5208",
              contractAddress: null,
              logs: [],
              logsBloom: "0x" + "00".repeat(256),
              status: "0x1",
              effectiveGasPrice: "0x1",
              type: "0x2",
            };
            break;
          case "eth_call": {
            const call = q.params[0],
              abi = abis[call.to.toLowerCase()],
              decoded = decodeFunctionData({ abi, data: call.data });
            const name = decoded.functionName;
            const values: any = {
              proposalCount: s.count,
              decimals: 18,
              token: manifest.contracts[0].address,
              balanceOf: s.balance,
              allowance: s.allowance,
              proposals: [
                zero,
                BigInt(s.commitEnd),
                BigInt(s.revealEnd),
                s.againstVotes,
                s.forVotes,
              ],
              ballots: [s.commitment, s.amount, s.revealed, s.reclaimed],
              approve: true,
              transfer: true,
              openProposal: s.count + 1n,
            };
            result = encodeFunctionResult({
              abi,
              functionName: name,
              result: values[name],
            });
            break;
          }
          default:
            throw Error("Unhandled RPC " + q.method);
        }
        return { jsonrpc: "2.0", id: q.id, result };
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          Array.isArray(request) ? request.map(respond) : respond(request),
        ),
      });
    },
  );
  await page.goto(options.path || "/");
  await expect(
    page.getByRole("heading", { name: "Your voice." }),
  ).toBeVisible();
  return s;
}
test("complete lifecycle, deadlines, backup recovery and token transfer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const s = await setup(page);
  await expect(
    page.getByRole("button", { name: "Commit vote", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open proposal ↗" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Open proposal ↗" }).click();
  await expect(page.getByRole("status")).toContainText(
    "each phase at least 1 hour",
  );
  await page.getByLabel("Proposal title").fill("Fund public goods");
  await page.getByLabel("Commit deadline").fill("2027-01-16T12:00");
  await page.getByLabel("Reveal deadline").fill("2027-01-16T14:00");
  // Deadlines derived from the mocked block, allowing two hours in each phase.
  await page
    .getByLabel("Commit deadline")
    .fill(new Date((s.now + 7200) * 1000).toISOString().slice(0, 16));
  await page
    .getByLabel("Reveal deadline")
    .fill(new Date((s.now + 14400) * 1000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Open proposal ↗" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Open proposal confirmed",
  );
  await page.getByLabel("Stake · QRM").fill("5");
  await page.getByRole("button", { name: "Generate secret" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export recovery secret" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("quorum-1-secret.json");
  await page.getByRole("button", { name: "Approve QRM", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Approve QRM stake confirmed",
  );
  await page.getByRole("button", { name: "Commit vote", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Commit vote and lock QRM confirmed",
  );
  await expect(
    page.getByRole("button", { name: "Commit vote", exact: true }),
  ).toBeDisabled();
  const recovery = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("quorum:"))!;
    return JSON.stringify({ key, ...JSON.parse(localStorage.getItem(key)!) });
  });
  await page.getByText("Restore a recovery secret").click();
  await page.getByLabel("Recovery JSON").fill("{}");
  await page
    .getByRole("button", { name: "Restore secret", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Secret must match");
  await page.getByLabel("Recovery JSON").fill(recovery);
  await page
    .getByRole("button", { name: "Restore secret", exact: true })
    .click();
  s.now = s.commitEnd;
  await page.getByRole("button", { name: "Refresh live state" }).click();
  await expect(
    page.getByRole("button", { name: "Reveal vote", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Reveal vote", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Reveal vote confirmed");
  expect(s.forVotes).toBe(5n * 10n ** 18n);
  s.now = s.revealEnd;
  await page.getByRole("button", { name: "Refresh live state" }).click();
  await expect(
    page.getByRole("button", { name: "Reclaim tokens" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Reclaim tokens" }).click();
  await expect(page.getByRole("status")).toContainText("Reclaim QRM confirmed");
  await page.getByLabel("Recipient").fill(account);
  await page.getByLabel("Amount · QRM", { exact: true }).fill("1");
  s.reject = true;
  await page.getByRole("button", { name: "Transfer QRM", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("rejected");
  s.reject = false;
  await page.getByRole("button", { name: "Transfer QRM", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Transfer QRM confirmed",
  );
  expect(s.actions).toEqual([
    "openProposal",
    "approve",
    "commitVote",
    "revealVote",
    "reclaim",
    "transfer",
  ]);
  expect(errors).toEqual([]);
});
test("wrong chain blocks actions and switching recovers", async ({ page }) => {
  await setup(page, { wrong: true });
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByText("Wrong network.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open proposal ↗" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Switch to Sepolia" }).click();
  await expect(
    page.getByRole("button", { name: "Open proposal ↗" }),
  ).toBeEnabled();
});
test("missing wallet is visible and safe", async ({ page }) => {
  await setup(page, { missing: true });
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(/provider|wallet/i);
  await expect(
    page.getByRole("button", { name: "Open proposal ↗" }),
  ).toBeDisabled();
});
test("RPC failure blocks signing", async ({ page }) => {
  await setup(page, { rpcFail: true });
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(/request|503|HTTP/i, {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Open proposal ↗" }),
  ).toBeDisabled();
});
for (const width of [390, 1440])
  test(`layout and resources at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await setup(page);
    await expect(page.getByRole("status")).toContainText("Live state updated");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `../docs/quorum-${width}.png`,
      fullPage: true,
    });
  });

test('missing deployed code blocks signing',async({page})=>{await setup(page,{emptyCode:true});await expect(page.getByRole('status')).toContainText('Deployed contract code missing');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await expect(page.getByRole('button',{name:'Open proposal ↗'})).toBeDisabled();});
test('tampered ABI fails closed',async({page})=>{await page.route('**/abi/Quorum.json',route=>route.fulfill({contentType:'application/json',body:'[]'}));await page.goto('/');await expect(page.getByRole('alert')).toContainText('ABI integrity check failed');await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toHaveCount(0);});
test('static export loads at a gateway subpath',async({page})=>{
 const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
 await page.route('http://127.0.0.1:4173/ipfs/mock/**',async route=>{const path=new URL(route.request().url()).pathname.slice('/ipfs/mock/'.length)||'index.html';const type=path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'text/html';await route.fulfill({contentType:type,body:readFileSync('../dist/'+path)});});
 await setup(page,{path:'/ipfs/mock/'});await expect(page.getByRole('status')).toContainText('Live state updated');expect(failures).toEqual([]);
});
