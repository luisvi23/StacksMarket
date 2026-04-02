const axios = require("axios");
const Poll = require("../models/Poll");
const { cvToHex, cvToJSON, deserializeCV, uintCV } = require("@stacks/transactions");
const { buildActiveMarketFilter } = require("./marketState");

function getNetwork() {
  const network = String(process.env.STACKS_NETWORK || "mainnet").toLowerCase();
  return network === "testnet" ? "testnet" : "mainnet";
}

function getHiroBaseUrl() {
  return getNetwork() === "testnet"
    ? "https://api.testnet.hiro.so"
    : "https://api.mainnet.hiro.so";
}

function getContractConfig() {
  const address =
    process.env.ONCHAIN_INDEXER_CONTRACT_ADDRESS ||
    process.env.CONTRACT_ADDRESS ||
    "ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP";
  const name =
    process.env.ONCHAIN_INDEXER_CONTRACT_NAME ||
    process.env.CONTRACT_NAME ||
    "market-factory-v20-bias";
  return { address, name };
}

function toBigIntOrNull(value) {
  if (value == null) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    const unsigned = raw.startsWith("u") ? raw.slice(1) : raw;
    if (!/^\d+$/.test(unsigned)) return null;
    try {
      return BigInt(unsigned);
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value.value != null) {
    return toBigIntOrNull(value.value);
  }
  return null;
}

function getTupleUint(tupleJson, key) {
  // cvToJSON wraps (ok (tuple ...)) as: { value: { type: "tuple", value: { key: { value: N } } } }
  // Fields live at value.value[key], not value[key]
  const fields = tupleJson?.value?.value ?? tupleJson?.value;
  return toBigIntOrNull(fields?.[key]?.value ?? fields?.[key]);
}

function deriveBinaryProbabilities({ b, qYes, qNo, rYes, rNo }) {
  if (b == null || b <= 0n) return null;
  if (qYes == null || qNo == null || rYes == null || rNo == null) return null;

  const qYesEffective = qYes + rYes;
  const qNoEffective = qNo + rNo;

  const bNum = Number(b);
  const diffNum = Number(qNoEffective - qYesEffective);
  if (!Number.isFinite(bNum) || bNum <= 0 || !Number.isFinite(diffNum)) return null;

  const x = diffNum / bNum;
  let pYes = 0.5;

  if (x > 60) pYes = 0;
  else if (x < -60) pYes = 1;
  else pYes = 1 / (1 + Math.exp(x));

  const yesPct = Math.max(0, Math.min(100, Math.round(pYes * 100)));
  const noPct = 100 - yesPct;
  return { pYes, pNo: 1 - pYes, yesPct, noPct };
}

async function fetchMarketSnapshotTuple(marketId, { timeoutMs = 8000 } = {}) {
  const { address, name } = getContractConfig();
  const hiroBase = getHiroBaseUrl();
  const hiroApiKey = process.env.HIRO_API_KEY;

  const hiroUrl = `${hiroBase}/v2/contracts/call-read/${address}/${name}/get-market-snapshot`;
  const payload = {
    sender: address,
    arguments: [cvToHex(uintCV(BigInt(marketId)))],
  };

  const response = await axios.post(hiroUrl, payload, {
    timeout: timeoutMs,
    headers: {
      "Content-Type": "application/json",
      ...(hiroApiKey ? { "x-api-key": hiroApiKey } : {}),
    },
  });

  if (!response?.data?.okay || !response?.data?.result) {
    throw new Error(
      `Hiro call-read get-market-snapshot failed: ${JSON.stringify(response?.data || {})}`
    );
  }

  const cv = deserializeCV(response.data.result);
  return cvToJSON(cv);
}

async function syncPollOddsFromOnChainSnapshot({
  pollId,
  poll: pollDoc,
  logger = console,
  timeoutMs,
} = {}) {
  const poll =
    pollDoc ||
    (pollId
      ? await Poll.findById(pollId)
      : null);

  if (!poll) return { synced: false, reason: "poll-not-found" };
  if (!poll.marketId) return { synced: false, reason: "poll-without-market-id" };
  if (!Array.isArray(poll.options) || poll.options.length !== 2) {
    return { synced: false, reason: "non-binary-poll" };
  }
  if (poll.isResolved) return { synced: false, reason: "poll-resolved" };

  const marketId = String(poll.marketId).trim();
  if (!/^\d+$/.test(marketId)) {
    return { synced: false, reason: "invalid-market-id" };
  }

  const tupleJson = await fetchMarketSnapshotTuple(marketId, { timeoutMs });
  const b = getTupleUint(tupleJson, "b");
  const qYes = getTupleUint(tupleJson, "qYes");
  const qNo = getTupleUint(tupleJson, "qNo");
  const rYes = getTupleUint(tupleJson, "rYes");
  const rNo = getTupleUint(tupleJson, "rNo");

  const odds = deriveBinaryProbabilities({ b, qYes, qNo, rYes, rNo });
  if (!odds) {
    return { synced: false, reason: "invalid-snapshot-values" };
  }

  poll.options[0].percentage = odds.yesPct;
  poll.options[1].percentage = odds.noPct;
  poll.options[0].impliedProbability = odds.yesPct;
  poll.options[1].impliedProbability = odds.noPct;
  await poll.updatePercentages();

  logger.log?.(
    `[onchain-odds-sync] poll=${poll._id} marketId=${marketId} yes=${odds.yesPct}% no=${odds.noPct}%`
  );

  return {
    synced: true,
    pollId: poll._id,
    marketId,
    yesPct: odds.yesPct,
    noPct: odds.noPct,
  };
}

// Returns { b, qYes, qNo, rYes, rNo } as BigInts, or null on failure
async function fetchParsedMarketSnapshot(marketId, { timeoutMs } = {}) {
  const tupleJson = await fetchMarketSnapshotTuple(marketId, { timeoutMs });
  const b    = getTupleUint(tupleJson, "b");
  const qYes = getTupleUint(tupleJson, "qYes");
  const qNo  = getTupleUint(tupleJson, "qNo");
  const rYes = getTupleUint(tupleJson, "rYes");
  const rNo  = getTupleUint(tupleJson, "rNo");
  if (b == null || qYes == null || qNo == null || rYes == null || rNo == null) return null;
  return { b, qYes, qNo, rYes, rNo };
}

async function syncAllActiveMarkets({ logger = console, timeoutMs } = {}) {
  const polls = await Poll.find({
    $and: [buildActiveMarketFilter(), { marketId: { $exists: true, $ne: "" } }],
  }).select("_id marketId options isResolved");

  // Process in small batches to avoid hitting Hiro API rate limits
  const CONCURRENCY = 5;
  let synced = 0;
  let failed = 0;
  for (let i = 0; i < polls.length; i += CONCURRENCY) {
    const batch = polls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((poll) => syncPollOddsFromOnChainSnapshot({ poll, logger, timeoutMs }))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value?.synced) synced++;
      else failed++;
    }
  }
  logger.log?.(`[onchain-odds-sync] startup sync: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}

module.exports = {
  syncPollOddsFromOnChainSnapshot,
  syncAllActiveMarkets,
  fetchMarketSnapshotTuple,
  fetchParsedMarketSnapshot,
  deriveBinaryProbabilities,
};
