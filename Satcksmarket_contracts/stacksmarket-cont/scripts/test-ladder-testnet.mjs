/**
 * test-ladder-testnet.mjs
 * Full ladder market test on Stacks testnet.
 * Contract: ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP.market-factory-v21-bias
 *
 * Test scenario: "Will BTC reach $X by end of April 2026?"
 * Rungs (gte):  $70k (m=101), $75k (m=102), $80k (m=103), $85k (m=104)
 * Final value:  $77,500 -> $70k YES, $75k YES, $80k NO, $85k NO
 */

import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  uintCV,
  stringAsciiCV,
  Cl,
} from "@stacks/transactions";
import { StacksTestnet } from "@stacks/network";
import { mnemonicToAccount } from "@stacks/wallet-sdk";

// ── Config ──────────────────────────────────────────────────────────────────
const MNEMONIC = "cart verb wealth parade slab logic monitor toss stool radio until devote security vanish violin give cause all cute swim rail add pigeon balcony";
const CONTRACT_ADDRESS = "ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP";
const CONTRACT_NAME    = "market-factory-v21-bias";
const NETWORK = new StacksTestnet({ url: "https://api.testnet.hiro.so" });

// Ladder group + market IDs (use high IDs to avoid collision with existing v20 markets)
const GROUP_ID          = 1n;
const MARKET_ID_70K     = 101n;
const MARKET_ID_75K     = 102n;
const MARKET_ID_80K     = 103n;
const MARKET_ID_85K     = 104n;

// Thresholds: price * 100 (e.g. $70,000.00 -> 7000000)
const THRESHOLD_70K = 7000000n;
const THRESHOLD_75K = 7500000n;
const THRESHOLD_80K = 8000000n;
const THRESHOLD_85K = 8500000n;

// Final value: $77,500 -> 7750000
const FINAL_VALUE = 7750000n;

// Initial liquidity per rung: 5 STX = 5_000_000 uSTX
const INITIAL_LIQUIDITY = 5_000_000n;

// Close time: 30 days from now (unix timestamp)
const CLOSE_TIME = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getAccount() {
  const { deriveStxAddressChain } = await import("@stacks/wallet-sdk");
  // Derive deployer private key from mnemonic (index 0)
  const { privateKey } = await deriveStxAddressChain(MNEMONIC, "testnet", 0);
  return privateKey;
}

async function getNonce(address) {
  const res = await fetch(`https://api.testnet.hiro.so/v2/accounts/${address}?proof=0`);
  const data = await res.json();
  return data.nonce;
}

async function broadcast(tx, label) {
  console.log(`\n→ Broadcasting: ${label}`);
  const result = await broadcastTransaction({ transaction: tx, network: NETWORK });
  if (result.error) {
    console.error(`  ✗ Error: ${result.error} — ${result.reason}`);
    throw new Error(result.reason || result.error);
  }
  console.log(`  ✓ txid: ${result.txid}`);
  return result.txid;
}

async function waitConfirmed(txid, label, maxWait = 180) {
  console.log(`  ⏳ Waiting for confirmation: ${label}...`);
  for (let i = 0; i < maxWait; i += 10) {
    await new Promise(r => setTimeout(r, 10000));
    const res = await fetch(`https://api.testnet.hiro.so/extended/v1/tx/${txid}`);
    const tx = await res.json();
    if (tx.tx_status === "success") {
      console.log(`  ✓ Confirmed at block ${tx.block_height}`);
      return true;
    }
    if (tx.tx_status === "abort_by_response" || tx.tx_status === "abort_by_post_condition") {
      console.error(`  ✗ Aborted: ${tx.tx_result?.repr}`);
      throw new Error(`TX aborted: ${tx.tx_result?.repr}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for ${txid}`);
}

async function callContract(privateKey, nonce, functionName, args, label) {
  const tx = await makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName,
    functionArgs: args,
    senderKey: privateKey,
    network: NETWORK,
    nonce: BigInt(nonce),
    fee: 2000n,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });
  const txid = await broadcast(tx, label);
  await waitConfirmed(txid, label);
  return txid;
}

async function readOnly(functionName, args) {
  const body = {
    sender: CONTRACT_ADDRESS,
    arguments: args.map(a => {
      // Simple Clarity value serialization for read-only
      return a;
    }),
  };
  const res = await fetch(
    `https://api.testnet.hiro.so/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/${functionName}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  return res.json();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Stacks Market v21 — Ladder Testnet Test ===\n");
  console.log(`Contract: ${CONTRACT_ADDRESS}.${CONTRACT_NAME}`);
  console.log(`Group ID: ${GROUP_ID}`);
  console.log(`Rungs: $70k(m=${MARKET_ID_70K}), $75k(m=${MARKET_ID_75K}), $80k(m=${MARKET_ID_80K}), $85k(m=${MARKET_ID_85K})`);
  console.log(`Final value: $77,500 → $70k YES, $75k YES, $80k NO, $85k NO\n`);

  // Derive private key
  let privateKey;
  try {
    // Try wallet-sdk approach
    const walletSdk = await import("@stacks/wallet-sdk");
    const wallet = await walletSdk.generateWallet({ secretKey: MNEMONIC, password: "" });
    const account = walletSdk.getStxAddress({ account: wallet.accounts[0], transactionVersion: 0x80 });
    privateKey = wallet.accounts[0].stxPrivateKey;
    console.log(`Deployer: ${account}`);
  } catch(e) {
    // Fallback: use known private key derivation
    console.log("wallet-sdk unavailable, using direct key");
    // The deployer private key for this testnet mnemonic
    // Derived from: cart verb wealth parade...
    privateKey = null;
  }

  if (!privateKey) {
    console.error("Could not derive private key. Install @stacks/wallet-sdk.");
    process.exit(1);
  }

  let nonce = await getNonce(CONTRACT_ADDRESS);
  console.log(`Current nonce: ${nonce}\n`);

  // ── Step 1: create-ladder-group ──────────────────────────────────────────
  console.log("━━━ Step 1: create-ladder-group ━━━");
  await callContract(privateKey, nonce++, "create-ladder-group", [
    uintCV(GROUP_ID),
    stringAsciiCV("Will BTC reach $X by end of April 2026?"),
    stringAsciiCV("Binance BTC/USDT 1m candle HIGH at 2026-04-30 23:59 UTC"),
    uintCV(CLOSE_TIME),
  ], "create-ladder-group(1)");

  // ── Step 2: add-rung x4 ─────────────────────────────────────────────────
  console.log("\n━━━ Step 2: add-rung x4 ━━━");
  const rungs = [
    { m: MARKET_ID_70K, thr: THRESHOLD_70K, label: "$70,000" },
    { m: MARKET_ID_75K, thr: THRESHOLD_75K, label: "$75,000" },
    { m: MARKET_ID_80K, thr: THRESHOLD_80K, label: "$80,000" },
    { m: MARKET_ID_85K, thr: THRESHOLD_85K, label: "$85,000" },
  ];

  for (const rung of rungs) {
    await callContract(privateKey, nonce++, "add-rung", [
      uintCV(GROUP_ID),
      uintCV(rung.m),
      uintCV(rung.thr),
      stringAsciiCV("gte"),
      stringAsciiCV(rung.label),
      uintCV(INITIAL_LIQUIDITY),
    ], `add-rung(g=1, m=${rung.m}, thr=${rung.thr}, label="${rung.label}")`);
  }

  // ── Step 3: verify group state ───────────────────────────────────────────
  console.log("\n━━━ Step 3: Verify on-chain state ━━━");
  const groupInfo = await readOnly("get-ladder-group-info", [
    "0x" + GROUP_ID.toString(16).padStart(32, "0").replace(/^/, "01"),
  ]);
  console.log("get-ladder-group-info:", groupInfo.result ? "✓ returned data" : "✗ failed");

  for (const rung of rungs) {
    const isRung = await readOnly("is-rung", [
      "0x01" + rung.m.toString(16).padStart(32, "0"),
    ]);
    console.log(`is-rung(${rung.m}): ${isRung.result === "0x03" ? "✓ true" : "✗ false (got " + isRung.result + ")"}`);
  }

  // ── Step 4: resolve-ladder-group ────────────────────────────────────────
  console.log("\n━━━ Step 4: resolve-ladder-group (final=$77,500) ━━━");
  await callContract(privateKey, nonce++, "resolve-ladder-group", [
    uintCV(GROUP_ID),
    uintCV(FINAL_VALUE),
  ], `resolve-ladder-group(1, ${FINAL_VALUE})`);

  // ── Step 5: resolve-rung x4 ─────────────────────────────────────────────
  console.log("\n━━━ Step 5: resolve-rung x4 ━━━");
  const expectedOutcomes = {
    [MARKET_ID_70K.toString()]: "YES",  // $77,500 >= $70,000 ✓
    [MARKET_ID_75K.toString()]: "YES",  // $77,500 >= $75,000 ✓
    [MARKET_ID_80K.toString()]: "NO",   // $77,500 >= $80,000 ✗
    [MARKET_ID_85K.toString()]: "NO",   // $77,500 >= $85,000 ✗
  };

  for (const rung of rungs) {
    console.log(`  Expected outcome for m=${rung.m} (${rung.label}): ${expectedOutcomes[rung.m.toString()]}`);
    await callContract(privateKey, nonce++, "resolve-rung", [
      uintCV(rung.m),
    ], `resolve-rung(m=${rung.m})`);
  }

  // ── Step 6: verify outcomes ──────────────────────────────────────────────
  console.log("\n━━━ Step 6: Verify outcomes ━━━");
  for (const rung of rungs) {
    const outcome = await readOnly("get-outcome", [
      "0x01" + rung.m.toString(16).padStart(32, "0"),
    ]);
    const expected = expectedOutcomes[rung.m.toString()];
    console.log(`  m=${rung.m} (${rung.label}): outcome=${outcome.result} expected=${expected}`);
  }

  console.log("\n✅ Ladder testnet test complete!");
  console.log(`\nGroup ID 1 deployed and resolved on testnet.`);
  console.log(`Contract: ${CONTRACT_ADDRESS}.${CONTRACT_NAME}`);
}

main().catch(e => {
  console.error("\n✗ Test failed:", e.message);
  process.exit(1);
});
