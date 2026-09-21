import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";
const h = JSON.parse(
  readFileSync(new URL("../deployment-handoff.json", import.meta.url)),
);
const canonical = (x) =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : x;
const manifest = {
  version: 1,
  launchId: h.launchId,
  chainId: h.chainId,
  sourceCommit: h.sourceCommit,
  attestationHash: h.attestationHash,
  contracts: h.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
    abiPath: `abi/${name}.json`,
  })),
  assets: [],
};
if (process.argv[2] === "prepare") {
  for (const c of manifest.contracts) {
    const raw = execFileSync(
      "git",
      ["show", `${h.sourceCommit}:docs/abi/${c.name}.json`],
      { encoding: "utf8" },
    );
    const abi = JSON.parse(raw);
    if (
      !Array.isArray(abi) ||
      keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2) !== c.abiHash
    )
      throw Error(`ABI mismatch: ${c.name}`);
    mkdirSync("public/abi", { recursive: true });
    writeFileSync(`public/${c.abiPath}`, raw);
  }
  writeFileSync(
    "public/imd-deployment.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
} else {
  const walk = (d, p = "") =>
    readdirSync(d).flatMap((n) =>
      statSync(`${d}/${n}`).isDirectory()
        ? walk(`${d}/${n}`, p + n + "/")
        : [p + n],
    );
  manifest.assets = walk("../dist")
    .filter((p) => p !== "imd-deployment.json")
    .sort()
    .map((path) => {
      const b = readFileSync("../dist/" + path);
      if (b.length > 8388608) throw Error("Asset too large");
      return { path, sha256: createHash("sha256").update(b).digest("hex") };
    });
  if (manifest.assets.length > 128) throw Error("Too many assets");
  writeFileSync(
    "../dist/imd-deployment.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`Verified ABIs; inventoried ${manifest.assets.length} assets`);
}
