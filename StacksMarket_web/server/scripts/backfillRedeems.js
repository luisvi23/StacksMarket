/**
 * backfillRedeems.js
 * ------------------
 * One-off script: for every successful on-chain redeem transaction already
 * stored in the Transaction collection, mark the corresponding trades as
 * claimed: true in the Trade collection.
 *
 * Usage:
 *   node server/scripts/backfillRedeems.js [--dry-run]
 *
 * Options:
 *   --dry-run   Print what would be updated without writing to DB.
 */

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const Transaction = require("../models/Transaction");
const Trade = require("../models/Trade");
const User = require("../models/User");

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI not set in .env");

  await mongoose.connect(mongoUri);
  console.log("[backfillRedeems] Connected to MongoDB");
  if (DRY_RUN) console.log("[backfillRedeems] DRY RUN — no writes will occur");

  // Fetch all successful redeem transactions
  const redeems = await Transaction.find({
    kind: "redeem",
    status: "success",
  }).lean();

  console.log(`[backfillRedeems] Found ${redeems.length} successful redeem transactions`);

  let totalMarked = 0;
  let alreadyClaimed = 0;
  let skipped = 0;

  for (const tx of redeems) {
    if (!tx.poll || !tx.walletAddress) {
      skipped++;
      continue;
    }

    // Resolve user from walletAddress (Transaction may already have tx.user but be safe)
    const user = tx.user
      ? { _id: tx.user }
      : await User.findOne({ walletAddress: tx.walletAddress }).select("_id").lean();

    if (!user) {
      console.warn(`[backfillRedeems] No user found for wallet=${tx.walletAddress} tx=${tx.txid}`);
      skipped++;
      continue;
    }

    // Check how many trades are not yet claimed
    const pendingCount = await Trade.countDocuments({
      poll: tx.poll,
      user: user._id,
      status: "completed",
      claimed: { $ne: true },
    });

    if (pendingCount === 0) {
      alreadyClaimed++;
      continue;
    }

    console.log(
      `[backfillRedeems] wallet=${tx.walletAddress} poll=${tx.poll} ` +
      `txid=${tx.txid} → marking ${pendingCount} trade(s) as claimed`
    );

    if (!DRY_RUN) {
      const result = await Trade.updateMany(
        {
          poll: tx.poll,
          user: user._id,
          status: "completed",
          claimed: { $ne: true },
        },
        {
          $set: {
            claimed: true,
            ...(tx.totalValue != null ? { payoutAmount: tx.totalValue } : {}),
          },
        }
      );
      totalMarked += result.modifiedCount;
    } else {
      totalMarked += pendingCount;
    }
  }

  console.log("\n[backfillRedeems] ── Summary ──────────────────────────");
  console.log(`  Redeem transactions processed : ${redeems.length}`);
  console.log(`  Trades marked as claimed      : ${totalMarked}`);
  console.log(`  Already claimed (no-op)       : ${alreadyClaimed}`);
  console.log(`  Skipped (missing data)        : ${skipped}`);
  if (DRY_RUN) console.log("  (DRY RUN — nothing was written)");
  console.log("[backfillRedeems] Done.");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[backfillRedeems] Fatal error:", err);
  process.exit(1);
});
