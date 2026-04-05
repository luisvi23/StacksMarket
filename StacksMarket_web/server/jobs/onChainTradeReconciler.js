const axios = require("axios");
const Trade = require("../models/Trade");
const Poll = require("../models/Poll");
const User = require("../models/User");
const { syncPollOddsFromOnChainSnapshot } = require("../utils/onChainOddsSync");
const { repairTradePricesForPoll } = require("./onChainTransactionIndexer");

const CHAIN_SYNC = {
  TX_SUBMITTED: "tx_submitted",
  CONFIRMED: "confirmed",
  FAILED: "failed",
};

const FAILED_TX_STATUSES = new Set([
  "abort_by_response",
  "abort_by_post_condition",
  "failed",
]);

function normalizeTxId(txId) {
  const raw = String(txId || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function getHiroBaseUrl() {
  const network = (process.env.STACKS_NETWORK || "mainnet").toLowerCase();
  return network === "testnet"
    ? "https://api.testnet.hiro.so"
    : "https://api.mainnet.hiro.so";
}

async function fetchTxFromHiro(txId, timeoutMs) {
  const hiroUrl = `${getHiroBaseUrl()}/extended/v1/tx/${normalizeTxId(txId)}`;
  const hiroApiKey = process.env.HIRO_API_KEY;
  const res = await axios.get(hiroUrl, {
    timeout: timeoutMs,
    headers: hiroApiKey ? { "x-api-key": hiroApiKey } : undefined,
  });
  return res.data;
}

async function emitTradeRealtime(io, trade) {
  if (!io || !trade) return;
  io.to(`poll-${trade.poll}`).emit("trade-updated", {
    pollId: trade.poll,
    trade,
    orderBook: await Trade.getOrderBook(trade.poll, trade.optionIndex),
  });
}

async function trySyncOnChainOdds(pollId, logger = console) {
  try {
    await syncPollOddsFromOnChainSnapshot({ pollId, logger });
  } catch (error) {
    logger.warn?.(
      `[onchain-odds-sync] failed poll=${pollId}: ${error?.message || error}`
    );
  }
}

async function updateOptionVolume(
  pollId,
  optionIndex,
  amount,
  price,
  { priceReliable = true, allowVolumeFallback = true } = {}
) {
  const optIdxNum = Number(optionIndex);

  const poll = await Poll.findById(pollId);
  if (!poll || !poll.options || !poll.options[optIdxNum]) return;

  const opt = poll.options[optIdxNum];
  opt.totalVolume += Number(amount) || 0;
  opt.totalTrades += 1;

  const nOptions = poll.options.length;
  const p = Number(price);
  let appliedProb = false;

  if (priceReliable && nOptions === 2 && Number.isFinite(p)) {
    const prob = p > 1 && p <= 100 ? p / 100 : p;
    if (prob >= 0 && prob <= 1) {
      const yesIdx = 0;
      const noIdx = 1;
      let yesProb = null;

      if (optIdxNum === yesIdx) yesProb = prob;
      if (optIdxNum === noIdx) yesProb = 1 - prob;

      if (yesProb != null) {
        const yesPct = Math.round(yesProb * 100);
        const noPct = 100 - yesPct;
        poll.options[yesIdx].percentage = yesPct;
        poll.options[noIdx].percentage = noPct;
        appliedProb = true;
      }
    }
  }

  if (!appliedProb && allowVolumeFallback && nOptions >= 2) {
    const vols = poll.options.map((o) => Number(o.totalVolume) || 0);
    const sumVol = vols.reduce((a, b) => a + b, 0);
    if (sumVol > 0) {
      poll.options.forEach((o, i) => {
        o.percentage = (vols[i] / sumVol) * 100;
      });
    }
  }

  if (appliedProb || (allowVolumeFallback && nOptions >= 2)) {
    await poll.updatePercentages();
  } else {
    await poll.save();
  }
}

async function updatePollStatistics(pollId) {
  const poll = await Poll.findById(pollId);
  if (!poll) return;

  const trades = await Trade.find({ poll: pollId, status: "completed" });

  poll.totalVolume = trades.reduce((sum, trade) => sum + (trade.totalValue || 0), 0);
  poll.totalTrades = trades.length;
  poll.uniqueTraders = new Set(trades.map((trade) => String(trade.user))).size;

  await poll.save();
}

async function finalizeSuccessIfPending(trade, io, logger = console) {
  const now = new Date();
  const transitioned = await Trade.findOneAndUpdate(
    { _id: trade._id, status: "pending" },
    {
      $set: {
        status: "completed",
        chainSyncStatus: CHAIN_SYNC.CONFIRMED,
        chainSyncError: "",
        filledAmount: trade.amount,
        remainingAmount: 0,
        txConfirmedAt: trade.txConfirmedAt || now,
        txAttachedAt: trade.txAttachedAt || now,
      },
    },
    { new: true }
  );

  if (!transitioned) return false;

  await updateOptionVolume(
    transitioned.poll,
    transitioned.optionIndex,
    transitioned.amount,
    transitioned.price,
    { priceReliable: false, allowVolumeFallback: false }
  );
  await updatePollStatistics(transitioned.poll);
  await trySyncOnChainOdds(transitioned.poll, logger);
  // Repair price on all completed trades for this poll so the chart has data
  await repairTradePricesForPoll(transitioned.poll, null, logger);
  await User.findByIdAndUpdate(transitioned.user, { $inc: { totalTrades: 1 } });
  await emitTradeRealtime(io, transitioned);
  return true;
}

async function finalizeFailureIfPending(trade, reason) {
  const transitioned = await Trade.findOneAndUpdate(
    { _id: trade._id, status: "pending" },
    {
      $set: {
        status: "failed",
        chainSyncStatus: CHAIN_SYNC.FAILED,
        chainSyncError: String(reason || "On-chain transaction failed").slice(0, 500),
      },
    },
    { new: true }
  );

  return !!transitioned;
}

function createOnChainTradeReconciler({ io, logger = console } = {}) {
  const intervalRaw = Number(process.env.TRADE_RECONCILER_INTERVAL_MS);
  const batchRaw = Number(process.env.TRADE_RECONCILER_BATCH_SIZE);
  const minAgeRaw = Number(process.env.TRADE_RECONCILER_MIN_AGE_MS);
  const hiroTimeoutRaw = Number(process.env.TRADE_RECONCILER_HIRO_TIMEOUT_MS);
  const intervalMs = Math.max(
    5000,
    Number.isFinite(intervalRaw) ? intervalRaw : 60000
  );
  const batchSize = Math.max(
    1,
    Math.min(200, Number.isFinite(batchRaw) ? batchRaw : 25)
  );
  const minAgeMs = Math.max(
    0,
    Number.isFinite(minAgeRaw) ? minAgeRaw : 15000
  );
  const hiroTimeoutMs = Math.max(1000, Number.isFinite(hiroTimeoutRaw) ? hiroTimeoutRaw : 10000);

  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const cutoff = new Date(Date.now() - minAgeMs);
      const pending = await Trade.find({
        isOnChain: true,
        status: "pending",
        chainSyncStatus: CHAIN_SYNC.TX_SUBMITTED,
        transactionHash: { $exists: true, $ne: "" },
        updatedAt: { $lte: cutoff },
      })
        .sort({ updatedAt: 1 })
        .limit(batchSize);

      if (!pending.length) return;

      let completed = 0;
      let failed = 0;
      let skipped = 0;

      for (const trade of pending) {
        try {
          const tx = await fetchTxFromHiro(trade.transactionHash, hiroTimeoutMs);
          const status = String(tx?.tx_status || "").toLowerCase();

          if (status === "success") {
            if (await finalizeSuccessIfPending(trade, io, logger)) completed += 1;
            else skipped += 1;
            continue;
          }

          if (FAILED_TX_STATUSES.has(status)) {
            const reason = tx?.tx_result?.repr || tx?.tx_result || `Transaction failed (${status})`;
            if (await finalizeFailureIfPending(trade, reason)) failed += 1;
            else skipped += 1;
            continue;
          }

          skipped += 1;
        } catch (err) {
          const status = err?.response?.status;
          if (status === 404) {
            skipped += 1;
            continue;
          }
          logger.error?.(
            "[trade-reconciler] Failed processing trade",
            trade._id?.toString?.() || trade._id,
            err?.message || err
          );
        }
      }

      if (completed || failed) {
        logger.log?.(
          `[trade-reconciler] batch processed=${pending.length} completed=${completed} failed=${failed} skipped=${skipped}`
        );
      }
    } catch (err) {
      logger.error?.("[trade-reconciler] Tick error:", err?.message || err);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    logger.log?.(
      `[trade-reconciler] enabled interval=${intervalMs}ms batch=${batchSize} minAge=${minAgeMs}ms`
    );
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    void tick();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = { createOnChainTradeReconciler };
