/**
 * backfillRedeemsOnChain.js
 * -------------------------
 * One-off script: for every user that has unclaimed trades on a resolved poll,
 * query the contract on-chain to check their share balance.
 * If balance is 0 → they already redeemed on-chain → mark trades as claimed: true.
 *
 * This covers historical redeems that happened before the indexer was deployed.
 *
 * Usage:
 *   node server/scripts/backfillRedeemsOnChain.js [--dry-run]
 *
 * Options:
 *   --dry-run   Print what would be updated without writing to DB.
 */

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const axios = require("axios");
const { cvToHex, cvToJSON, deserializeCV, uintCV, standardPrincipalCV } = require("@stacks/transactions");

dotenv.config({ path: path.join(__dirname, "../.env") });

const Trade = require("../models/Trade");
const Poll = require("../models/Poll");
const User = require("../models/User");

const DRY_RUN = process.argv.includes("--dry-run");

const NETWORK = String(process.env.STACKS_NETWORK || "mainnet").toLowerCase() === "testnet"
  ? "testnet" : "mainnet";
const HIRO_BASE = NETWORK === "testnet"
  ? "https://api.testnet.hiro.so"
  : "https://api.mainnet.hiro.so";
const CONTRACT_ADDRESS =
  process.env.ONCHAIN_INDEXER_CONTRACT_ADDRESS ||
  process.env.CONTRACT_ADDRESS ||
  "SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA";
const CONTRACT_NAME =
  process.env.ONCHAIN_INDEXER_CONTRACT_NAME ||
  process.env.CONTRACT_NAME ||
  "market-factory-v20-bias";
const HIRO_API_KEY = process.env.HIRO_API_KEY;
const TIMEOUT_MS = 8000;
const DELAY_MS = 600; // throttle between Hiro calls

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function callReadOnly(functionName, args, retries = 5) {
  const url = `${HIRO_BASE}/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/${functionName}`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.post(
        url,
        { sender: CONTRACT_ADDRESS, arguments: args },
        {
          timeout: TIMEOUT_MS,
          headers: {
            "Content-Type": "application/json",
            ...(HIRO_API_KEY ? { "x-api-key": HIRO_API_KEY } : {}),
          },
        }
      );
      if (!res?.data?.okay || !res?.data?.result) {
        throw new Error(`call-read ${functionName} failed: ${JSON.stringify(res?.data)}`);
      }
      const cv = deserializeCV(res.data.result);
      return cvToJSON(cv);
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      if (status === 429) {
        const backoff = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s, 32s
        console.warn(`  [429] Rate limited — waiting ${backoff / 1000}s before retry ${attempt + 1}/${retries}...`);
        await wait(backoff);
        continue;
      }
      throw err; // non-429 errors fail immediately
    }
  }
  throw lastErr;
}

async function getShareBalance(functionName, marketId, walletAddress) {
  try {
    const result = await callReadOnly(functionName, [
      cvToHex(uintCV(BigInt(marketId))),
      cvToHex(standardPrincipalCV(walletAddress)),
    ]);
    // result is a uint: { type: "uint", value: "0" }
    const val = result?.value ?? result;
    const n = Number(typeof val === "object" ? val?.value ?? val : val);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI not set in .env");

  await mongoose.connect(mongoUri);
  console.log("[backfillRedeemsOnChain] Connected to MongoDB");
  console.log(`[backfillRedeemsOnChain] Network: ${NETWORK} | Contract: ${CONTRACT_ADDRESS}.${CONTRACT_NAME}`);
  if (DRY_RUN) console.log("[backfillRedeemsOnChain] DRY RUN — no writes will occur\n");

  // 1. Find all user+poll combos with unclaimed completed trades on resolved polls
  const candidates = await Trade.aggregate([
    { $match: { status: "completed", claimed: { $ne: true } } },
    {
      $lookup: {
        from: "polls",
        localField: "poll",
        foreignField: "_id",
        as: "pollDoc",
      },
    },
    { $unwind: "$pollDoc" },
    {
      $match: {
        "pollDoc.isResolved": true,
        "pollDoc.winningOption": { $ne: null },
        "pollDoc.marketId": { $exists: true, $ne: "" },
      },
    },
    {
      $group: {
        _id: { user: "$user", poll: "$poll" },
        marketId: { $first: "$pollDoc.marketId" },
        winningOption: { $first: "$pollDoc.winningOption" },
        tradeCount: { $sum: 1 },
      },
    },
  ]);

  console.log(`[backfillRedeemsOnChain] Found ${candidates.length} user+poll combos with unclaimed trades on resolved polls\n`);

  let totalMarked = 0;
  let stillHolding = 0;
  let skipped = 0;
  let errors = 0;

  for (const c of candidates) {
    const { user: userId, poll: pollId } = c._id;
    const { marketId, winningOption } = c;

    if (!/^\d+$/.test(String(marketId).trim())) {
      skipped++;
      continue;
    }

    const user = await User.findById(userId).select("walletAddress").lean();
    if (!user?.walletAddress) {
      skipped++;
      continue;
    }

    // Query on-chain balance for the winning option
    const balanceFn = winningOption === 0 ? "get-yes-balance" : "get-no-balance";

    await wait(DELAY_MS);
    const balance = await getShareBalance(balanceFn, marketId, user.walletAddress);

    if (balance === null) {
      console.warn(`  [error] Could not fetch balance for wallet=${user.walletAddress} marketId=${marketId}`);
      errors++;
      continue;
    }

    if (balance > 0) {
      // User still holds shares — has NOT redeemed
      console.log(`  [holding] wallet=${user.walletAddress} marketId=${marketId} balance=${balance} shares → skip`);
      stillHolding++;
      continue;
    }

    // balance === 0 → redeemed on-chain
    console.log(`  [claimed] wallet=${user.walletAddress} marketId=${marketId} → marking ${c.tradeCount} trade(s) as claimed`);

    if (!DRY_RUN) {
      const result = await Trade.updateMany(
        {
          poll: pollId,
          user: userId,
          status: "completed",
          claimed: { $ne: true },
        },
        { $set: { claimed: true } }
      );
      totalMarked += result.modifiedCount;
    } else {
      totalMarked += c.tradeCount;
    }
  }

  console.log("\n[backfillRedeemsOnChain] ── Summary ──────────────────────────");
  console.log(`  User+poll combos checked      : ${candidates.length}`);
  console.log(`  Trades marked as claimed      : ${totalMarked}`);
  console.log(`  Still holding shares (skip)   : ${stillHolding}`);
  console.log(`  Skipped (missing data)        : ${skipped}`);
  console.log(`  Errors (Hiro API)             : ${errors}`);
  if (DRY_RUN) console.log("  (DRY RUN — nothing was written)");
  console.log("[backfillRedeemsOnChain] Done.");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[backfillRedeemsOnChain] Fatal error:", err);
  process.exit(1);
});
