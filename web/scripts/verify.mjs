import {readFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {keccak256,toBytes} from 'viem';
const m=JSON.parse(readFileSync('../dist/imd-deployment.json'));
const h=JSON.parse(readFileSync('deployment-handoff.json'));
for(const k of ['launchId','chainId','sourceCommit','attestationHash'])assert.equal(m[k],h[k]);
assert.equal(m.version,1);
assert.equal(m.contracts.length,h.contracts.length);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
for(const c of m.contracts){const expected=h.contracts.find(x=>x.name===c.name);for(const k of ['name','address','abiHash'])assert.equal(c[k],expected[k]);assert.match(c.abiPath,/^abi\/[\w.-]+\.json$/);const abi=JSON.parse(readFileSync('../dist/'+c.abiPath));assert.equal(keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2),c.abiHash);}
const walk=(d,p='')=>readdirSync(d).flatMap(n=>statSync(`${d}/${n}`).isDirectory()?walk(`${d}/${n}`,p+n+'/'):[p+n]);
const files=walk('../dist').filter(p=>p!=='imd-deployment.json').sort();assert.deepEqual(m.assets.map(x=>x.path).sort(),files);assert.ok(files.length<=128);
let bytes=0;for(const a of m.assets){assert.ok(!a.path.includes('..')&&!a.path.startsWith('/'));const b=readFileSync('../dist/'+a.path);bytes+=b.length;assert.ok(b.length<=8388608);assert.equal(createHash('sha256').update(b).digest('hex'),a.sha256);}
assert.ok(bytes<8*1024*1024);console.log(JSON.stringify({assets:files.length,exportBytes:bytes,abiHashes:'match',handoff:'match',assetHashes:'match'},null,2));
