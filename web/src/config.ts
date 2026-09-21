import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  toBytes,
  type Abi,
  type Address,
} from "viem";
export const network = {
  name: "Sepolia",
  rpc: "https://ethereum-sepolia-rpc.publicnode.com",
  explorer: "https://sepolia.etherscan.io",
};
export type Deployment = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
    abi?: Abi;
  }[];
};
const canonical = (x: any): any =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : x;
export async function loadDeployment() {
  const response = await fetch("./imd-deployment.json");
  if (!response.ok) throw Error("Deployment configuration unavailable");
  const d: Deployment = await response.json();
  if (d.version !== 1 || !d.contracts?.length)
    throw Error("Invalid deployment configuration");
  for (const c of d.contracts) {
    if (!/^abi\/[\w.-]+\.json$/.test(c.abiPath))
      throw Error("Invalid ABI path");
    const r = await fetch("./" + c.abiPath);
    if (!r.ok) throw Error("ABI unavailable");
    c.abi = await r.json();
    if (
      keccak256(toBytes(JSON.stringify(canonical(c.abi)))).slice(2) !==
      c.abiHash
    )
      throw Error("ABI integrity check failed");
  }
  const chain = defineChain({
    id: d.chainId,
    name: network.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpc] } },
    blockExplorers: { default: { name: "Etherscan", url: network.explorer } },
  });
  return {
    d,
    chain,
    client: createPublicClient({
      chain,
      transport: http(network.rpc, { timeout: 12000, retryCount: 1 }),
    }),
  };
}
export type Runtime = Awaited<ReturnType<typeof loadDeployment>>;
