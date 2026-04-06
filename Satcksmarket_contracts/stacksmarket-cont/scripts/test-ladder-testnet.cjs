/**
 * test-ladder-testnet.cjs
 * Full ladder market test on Stacks testnet.
 * Contract: ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP.market-factory-v21-bias
 *
 * Scenario: "Will BTC reach $X by end of April 2026?"
 * Rungs (gte): $70k(m=101), $75k(m=102), $80k(m=103), $85k(m=104)
 * Final value: $77,500 -> $70k YES, $75k YES, $80k NO, $85k NO
 */

const { generateWallet } = require("@stacks/wallet-sdk");
const {
  makeContractCall,
  broadcastTransaction,
  uintCV,
  stringAsciiCV,
  AnchorMode,
  PostConditionMode,
  getAddressFromPrivateKey,
} = require("@stacks/transactions");
const { STACKS_TESTNET } = require("@stacks/network");

// ── Config ────────────────────────────────────────────────────────────────────
const MNEMONIC = "cart verb wealth parade slab logic monitor toss stool radio until devote security vanish violin give cause all cute swim rail add pigeon balcony";
const CONTRACT_ADDRESS = "ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP";
const CONTRACT_NAME    = "market-factory-v21-bias";
const API             = "https://api.testnet.hiro.so";
const NETWORK         = STACKS_TESTNET;

const GROUP_ID        = 1n;
const MARKET_70K      = 101n;
const MARKET_75K      = 102n;
const MARKET_80K      = 103n;
const MARKET_85K      = 104n;
// Thresholds = price * 100 (2 decimal places, integer)
const THR_70K         = 7000000n;  // $70,000.00
const THR_75K         = 7500000n;  // $75,000.00
const THR_80K         = 8000000n;  // $80,000.00
const THR_85K         = 8500000n;  // $85,000.00
const FINAL_VALUE     = 7750000n;  // $77,500.00 -> YES for 70k,75k; NO for 80k,85k
const LIQUIDITY       = 5_000_000n; // 5 STX per rung
const CLOSE_TIME      = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getNonce() {
  const r = await fetch(`${API}/v2/accounts/${CONTRACT_ADDRESS}?proof=0`);
  const d = await r.json();
  return d.nonce;
}

async function broadcast(tx, label) {
  process.stdout.write(`\n  → ${label} ... `);
  const result = await broadcastTransaction({ transaction: tx, network: NETWORK });
  if (result.error) {
    console.log(`✗\n    Error: ${result.error} — ${result.reason || ""}`);
    throw new Error(result.reason || result.error);
  }
  console.log(`✓  txid: ${result.txid}`);
  return result.txid;
}

async function waitFor(txid, timeout = 300) {
  process.stdout.write(`     ⏳ confirming`);
  for (let i = 0; i < timeout; i += 10) {
    await new Promise(r => setTimeout(r, 10000));
    const r = await fetch(`${API}/extended/v1/tx/${txid}`);
    const tx = await r.json();
    if (tx.tx_status === "success") {
      console.log(` ✓  (block ${tx.block_height})`);
      return;
    }
    if (tx.tx_status?.startsWith("abort")) {
      const repr = tx.tx_result?.repr || "";
      console.log(` ✗\n    Aborted: ${repr}`);
      throw new Error(`TX aborted: ${repr}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for ${txid}`);
}

async function call(privKey, nonce, fn, args, label) {
  const tx = await makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: fn,
    functionArgs: args,
    senderKey: privKey,
    network: NETWORK,
    nonce: BigInt(nonce),
    fee: 5000n,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });
  const txid = await broadcast(tx, label);
  await waitFor(txid);
  return txid;
}

async function readOnly(fn, hexArgs) {
  const r = await fetch(`${API}/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: CONTRACT_ADDRESS, arguments: hexArgs }),
  });
  return r.json();
}

function toUintHex(n) {
  return "0x01" + BigInt(n).toString(16).padStart(32, "0");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Stacks Market v21 — Ladder Testnet Test             ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log(`Contract : ${CONTRACT_ADDRESS}.${CONTRACT_NAME}`);
  console.log(`Group    : ${GROUP_ID} — "Will BTC reach $X by end of April 2026?"`);
  console.log(`Rungs    : $70k(${MARKET_70K}), $75k(${MARKET_75K}), $80k(${MARKET_80K}), $85k(${MARKET_85K})`);
  console.log(`Final    : $77,500 → 70k=YES, 75k=YES, 80k=NO, 85k=NO\n`);

  // Derive private key
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const privKey = wallet.accounts[0].stxPrivateKey;
  const address = getAddressFromPrivateKey(privKey, NETWORK);
  console.log(`Deployer : ${address}`);

  let nonce = await getNonce();
  console.log(`Nonce    : ${nonce}\n`);

  // ── 1. create-ladder-group ─────────────────────────────────────────────────
  console.log("━━━ [1/6] create-ladder-group ━━━");
  await call(privKey, nonce++, "create-ladder-group", [
    uintCV(GROUP_ID),
    stringAsciiCV("Will BTC reach $X by end of April 2026?"),
    stringAsciiCV("Binance BTC/USDT 1m candle HIGH 2026-04-30 23:59 UTC"),
    uintCV(CLOSE_TIME),
  ], "create-ladder-group(g=1)");

  // ── 2. add-rung x4 ────────────────────────────────────────────────────────
  console.log("\n━━━ [2/6] add-rung x4 ━━━");
  const rungs = [
    { m: MARKET_70K, thr: THR_70K, label: "$70,000" },
    { m: MARKET_75K, thr: THR_75K, label: "$75,000" },
    { m: MARKET_80K, thr: THR_80K, label: "$80,000" },
    { m: MARKET_85K, thr: THR_85K, label: "$85,000" },
  ];
  for (const r of rungs) {
    await call(privKey, nonce++, "add-rung", [
      uintCV(GROUP_ID),
      uintCV(r.m),
      uintCV(r.thr),
      stringAsciiCV("gte"),
      stringAsciiCV(r.label),
      uintCV(LIQUIDITY),
    ], `add-rung(m=${r.m}, thr=${r.thr}, "${r.label}")`);
  }

  // ── 3. Verify: is-rung and group state ────────────────────────────────────
  console.log("\n━━━ [3/6] Verify on-chain state ━━━");
  for (const r of rungs) {
    const res = await readOnly("is-rung", [toUintHex(r.m)]);
    const ok = res.result === "0x03";
    console.log(`  is-rung(${r.m}) [${r.label}]: ${ok ? "✓ true" : "✗ false — " + res.result}`);
  }
  const groupRes = await readOnly("get-ladder-group-info", [toUintHex(GROUP_ID)]);
  console.log(`  get-ladder-group-info(1): ${groupRes.okay ? "✓ returned data" : "✗ " + JSON.stringify(groupRes)}`);

  // ── 4. resolve-ladder-group ───────────────────────────────────────────────
  console.log("\n━━━ [4/6] resolve-ladder-group (final=$77,500) ━━━");
  await call(privKey, nonce++, "resolve-ladder-group", [
    uintCV(GROUP_ID),
    uintCV(FINAL_VALUE),
  ], `resolve-ladder-group(g=1, val=${FINAL_VALUE})`);

  // ── 5. resolve-rung x4 ────────────────────────────────────────────────────
  console.log("\n━━━ [5/6] resolve-rung x4 ━━━");
  const expected = {
    [String(MARKET_70K)]: "YES",
    [String(MARKET_75K)]: "YES",
    [String(MARKET_80K)]: "NO",
    [String(MARKET_85K)]: "NO",
  };
  for (const r of rungs) {
    console.log(`  Expected m=${r.m} (${r.label}): ${expected[String(r.m)]}`);
    await call(privKey, nonce++, "resolve-rung", [
      uintCV(r.m),
    ], `resolve-rung(m=${r.m})`);
  }

  // ── 6. Verify outcomes ────────────────────────────────────────────────────
  console.log("\n━━━ [6/6] Verify final outcomes ━━━");
  let allOk = true;
  for (const r of rungs) {
    const res = await readOnly("get-outcome", [toUintHex(r.m)]);
    // Result is a Clarity string-ascii — decode from hex
    const hex = res.result?.replace("0x", "") || "";
    // Format: 0d + 4-byte length + ascii bytes
    const len = parseInt(hex.substring(2, 10), 16);
    const outcome = Buffer.from(hex.substring(10, 10 + len * 2), "hex").toString("ascii");
    const exp = expected[String(r.m)];
    const ok = outcome === exp;
    if (!ok) allOk = false;
    console.log(`  m=${r.m} (${r.label}): outcome="${outcome}" expected="${exp}" ${ok ? "✓" : "✗ MISMATCH"}`);
  }

  console.log(`\n${"═".repeat(54)}`);
  if (allOk) {
    console.log("✅  ALL TESTS PASSED — Ladder market v21 working on testnet");
  } else {
    console.log("❌  SOME TESTS FAILED — check outcomes above");
  }
  console.log(`${"═".repeat(54)}`);
  console.log(`\nContract : ${CONTRACT_ADDRESS}.${CONTRACT_NAME}`);
  console.log(`Group ID : 1`);
  console.log(`Explorer : https://explorer.hiro.so/address/${CONTRACT_ADDRESS}?chain=testnet`);
}

main().catch(e => {
  console.error("\n✗ Fatal:", e.message);
  process.exit(1);
});
