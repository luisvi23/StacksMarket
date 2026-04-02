const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Poll = require("../models/Poll");
const { syncPollOddsFromOnChainSnapshot } = require("../utils/onChainOddsSync");
const { buildActiveMarketFilter } = require("../utils/marketState");

dotenv.config();

function readArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

async function run() {
  const pollId = readArg("poll");
  const marketId = readArg("market-id");
  const limitRaw = Number(readArg("limit"));
  const timeoutRaw = Number(readArg("timeout-ms"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 500;
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 10000;

  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/stacksmarket";
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    const and = [{ marketId: { $exists: true, $ne: null } }];
    if (pollId) and.push({ _id: pollId });
    if (marketId) and.push({ marketId: String(marketId).trim() });

    // Default mode: only active markets. Targeted runs (--poll / --market-id) keep explicit scope.
    if (!pollId && !marketId) {
      and.push(buildActiveMarketFilter());
    }

    const query = and.length === 1 ? and[0] : { $and: and };

    const polls = await Poll.find(query)
      .sort({ updatedAt: 1 })
      .limit(limit)
      .select("_id marketId options isResolved");

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const poll of polls) {
      try {
        const out = await syncPollOddsFromOnChainSnapshot({
          poll,
          logger: console,
          timeoutMs,
        });

        if (out?.synced) synced += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `[backfill-onchain-odds] poll=${poll._id} marketId=${poll.marketId} error=${err?.message || err}`
        );
      }
    }

    console.log(
      `[backfill-onchain-odds] done total=${polls.length} synced=${synced} skipped=${skipped} failed=${failed}`
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error("[backfill-onchain-odds] fatal:", err?.message || err);
  process.exitCode = 1;
});
