// routes/trades.js
const express = require("express");
const axios = require("axios");
const Trade = require("../models/Trade");
const Poll = require("../models/Poll");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const { syncPollOddsFromOnChainSnapshot } = require("../utils/onChainOddsSync");

const router = express.Router();
const ONCHAIN_CHAIN_SYNC = {
  NONE: "none",
  INTENT_CREATED: "intent_created",
  TX_SUBMITTED: "tx_submitted",
  CONFIRMED: "confirmed",
  FAILED: "failed",
};

function normalizeTxId(txId) {
  if (typeof txId !== "string") return "";
  const raw = txId.trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function normalizeWalletAddress(address) {
  return String(address || "")
    .trim()
    .toLowerCase();
}

function getHiroConfig() {
  const network = (process.env.STACKS_NETWORK || "mainnet").toLowerCase();
  const hiroBase =
    network === "testnet" ? "https://api.testnet.hiro.so" : "https://api.mainnet.hiro.so";
  const hiroApiKey = process.env.HIRO_API_KEY;
  return { hiroBase, hiroApiKey };
}

async function fetchTxDetailsFromHiro(txId) {
  const normalizedTxId = normalizeTxId(txId);
  if (!normalizedTxId) {
    const err = new Error("txId is required");
    err.statusCode = 400;
    throw err;
  }

  const { hiroBase, hiroApiKey } = getHiroConfig();
  const hiroUrl = `${hiroBase}/extended/v1/tx/${normalizedTxId}`;
  try {
    const response = await axios.get(hiroUrl, {
      headers: hiroApiKey ? { "x-api-key": hiroApiKey } : undefined,
    });
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const err = new Error(
      status === 404
        ? "Transaction not found on Hiro API"
        : "Failed to verify transaction sender on Hiro API"
    );
    err.statusCode = status === 404 ? 404 : 502;
    throw err;
  }
}

async function assertTxSenderMatchesAuthenticatedUser(txId, walletAddress) {
  const expectedWallet = normalizeWalletAddress(walletAddress);
  if (!expectedWallet) {
    const err = new Error("Authenticated user has no wallet address");
    err.statusCode = 400;
    throw err;
  }

  const txDetails = await fetchTxDetailsFromHiro(txId);
  const sender = normalizeWalletAddress(txDetails?.sender_address);
  if (!sender) {
    const err = new Error("Transaction sender address unavailable");
    err.statusCode = 502;
    throw err;
  }

  if (sender !== expectedWallet) {
    const err = new Error(
      "Connected wallet does not match the authenticated account. Please re-login with the signing wallet."
    );
    err.statusCode = 403;
    throw err;
  }

  return txDetails;
}

async function emitTradeRealtime(req, trade) {
  const io = req.app.get("io");
  if (!io || !trade) return;

  io.to(`poll-${trade.poll}`).emit("trade-updated", {
    pollId: trade.poll,
    trade,
    orderBook: await Trade.getOrderBook(trade.poll, trade.optionIndex),
  });
}

async function trySyncOnChainOdds(pollId) {
  try {
    await syncPollOddsFromOnChainSnapshot({ pollId, logger: console });
  } catch (error) {
    console.warn(
      `[onchain-odds-sync] failed poll=${pollId}: ${error?.message || error}`
    );
  }
}

async function parseOnChainTradePayload(req, { requireClientOperationId = false } = {}) {
  const {
    pollId,
    type,
    optionIndex,
    amount,
    price,
    totalValue,
    userSats,
    totalSats,
    feeProtocol,
    feeLP,
    orderType = "market",
    clientOperationId,
  } = req.body;

  const amtNum = Number(amount);
  const priceNum = Number(price);
  const totalValueNum = totalValue != null ? Number(totalValue) : null;
  const userSatsNum = userSats != null ? Number(userSats) : null;
  const totalSatsNum = totalSats != null ? Number(totalSats) : null;
  const feeProtocolNum = feeProtocol != null ? Number(feeProtocol) : null;
  const feeLPNum = feeLP != null ? Number(feeLP) : null;
  const optIdxNum = Number(optionIndex);
  const clientOpId = typeof clientOperationId === "string" ? clientOperationId.trim() : "";

  if (
    !pollId ||
    !type ||
    !Number.isInteger(optIdxNum) ||
    !Number.isFinite(amtNum) ||
    !Number.isFinite(priceNum) ||
    !Number.isFinite(totalValueNum)
  ) {
    return { error: { status: 400, message: "Missing or invalid fields" } };
  }

  if (requireClientOperationId && !clientOpId) {
    return { error: { status: 400, message: "clientOperationId is required" } };
  }

  if (type !== "buy" && type !== "sell") {
    return { error: { status: 400, message: "Invalid trade type" } };
  }

  const poll = await Poll.findById(pollId);
  if (!poll || !poll.isActive) {
    return { error: { status: 404, message: "Poll not found or inactive" } };
  }

  if (optIdxNum < 0 || optIdxNum >= poll.options.length) {
    return { error: { status: 400, message: "Invalid option index" } };
  }

  if (amtNum <= 0) {
    return { error: { status: 400, message: "Amount must be greater than 0" } };
  }

  if (priceNum < 0 || priceNum > 1) {
    return { error: { status: 400, message: "Invalid price (must be 0..1)" } };
  }

  if (totalValueNum <= 0) {
    return { error: { status: 400, message: "Invalid totalValue for on-chain trade" } };
  }

  const numFields = [
    { key: "userSats", val: userSatsNum },
    { key: "totalSats", val: totalSatsNum },
    { key: "feeProtocol", val: feeProtocolNum },
    { key: "feeLP", val: feeLPNum },
  ];
  for (const f of numFields) {
    if (f.val == null) continue;
    if (!Number.isFinite(f.val) || f.val < 0) {
      return { error: { status: 400, message: `Invalid ${f.key}` } };
    }
  }

  return {
    poll,
    data: {
      pollId,
      type,
      optionIndex: optIdxNum,
      amount: amtNum,
      price: priceNum,
      totalValue: totalValueNum,
      userSats: userSatsNum,
      totalSats: totalSatsNum,
      feeProtocol: feeProtocolNum,
      feeLP: feeLPNum,
      orderType,
      clientOperationId: clientOpId || undefined,
    },
  };
}

async function attachTxToOnChainTrade(trade, txId) {
  const tx = normalizeTxId(txId);
  if (!tx) {
    const err = new Error("txId is required");
    err.statusCode = 400;
    throw err;
  }

  if (trade.transactionHash && trade.transactionHash !== tx) {
    const err = new Error("Trade already linked to a different txId");
    err.statusCode = 409;
    throw err;
  }

  const duplicate = await Trade.findOne({
    _id: { $ne: trade._id },
    transactionHash: tx,
  }).select("_id user");
  if (duplicate) {
    const err = new Error("txId already linked to another trade");
    err.statusCode = 409;
    throw err;
  }

  trade.transactionHash = tx;
  if (trade.status !== "completed" && trade.status !== "failed") {
    trade.status = "pending";
  }
  if (trade.chainSyncStatus !== ONCHAIN_CHAIN_SYNC.CONFIRMED) {
    trade.chainSyncStatus = ONCHAIN_CHAIN_SYNC.TX_SUBMITTED;
  }
  if (!trade.txAttachedAt) trade.txAttachedAt = new Date();
  trade.chainSyncError = "";

  await trade.save();
  return trade;
}

async function finalizeOnChainTradeSuccess(req, trade) {
  const now = new Date();

  // Atomic transition: only succeeds if the trade is not already completed.
  // Prevents double-finalization if the reconciler and the client race.
  const transitioned = await Trade.findOneAndUpdate(
    { _id: trade._id, status: { $ne: "completed" } },
    {
      $set: {
        status: "completed",
        chainSyncStatus: ONCHAIN_CHAIN_SYNC.CONFIRMED,
        chainSyncError: "",
        filledAmount: trade.amount,
        remainingAmount: 0,
        txConfirmedAt: trade.txConfirmedAt || now,
      },
    },
    { new: true }
  );

  // Another process already completed this trade — skip side effects.
  if (!transitioned) return trade;

  await updateOptionVolume(transitioned.poll, transitioned.optionIndex, transitioned.amount, transitioned.price, {
    priceReliable: false,
    allowVolumeFallback: false,
  });
  await updatePollStatistics(transitioned.poll);
  await trySyncOnChainOdds(transitioned.poll);
  await User.findByIdAndUpdate(req.user._id, { $inc: { totalTrades: 1 } });
  await emitTradeRealtime(req, transitioned);

  return transitioned;
}

async function finalizeOnChainTradeFailure(trade, failureReason) {
  const err = typeof failureReason === "string" ? failureReason.slice(0, 500) : "";

  // Atomic transition: only fails if not already completed or failed.
  const transitioned = await Trade.findOneAndUpdate(
    { _id: trade._id, status: { $nin: ["completed", "failed"] } },
    {
      $set: {
        status: "failed",
        chainSyncStatus: ONCHAIN_CHAIN_SYNC.FAILED,
        chainSyncError: err,
      },
    },
    { new: true }
  );

  if (!transitioned) {
    // Already completed — cannot mark as failed.
    if (trade.status === "completed") {
      const e = new Error("Completed trade cannot be marked as failed");
      e.statusCode = 409;
      throw e;
    }
    // Already failed — idempotent, return current state.
    return trade;
  }

  return transitioned;
}

/**
 * POST /api/trades
 * Create a new trade (buy/sell)
 *
 * Campos:
 * - amount: número de shares (>= 1)
 * - price: "unit price" / prob-style para off-chain (0–1). Para on-chain, se guarda lo que mande el front.
 * - totalValue: coste total (uSTX, recomendado para on-chain; obligatorio si txId existe)
 *
 * Nota:
 * - Off-chain: price ∈ [0,1] y totalValue = amount * price (unidades internas).
 * - On-chain: txId presente => totalValue obligatorio (uSTX). price se guarda como metadata UI.
 */
router.post("/", auth, async (req, res) => {
  try {
    const {
      pollId,
      type,
      optionIndex,
      amount,
      price,
      totalValue, // requerido si on-chain
      userSats,
      totalSats,
      feeProtocol,
      feeLP,
      orderType = "market",
      txId, // si existe => on-chain
    } = req.body;

    const normalizedTxId = normalizeTxId(String(txId || ""));
    const isOnChain = !!normalizedTxId;

    const amtNum = Number(amount);
    const priceNum = Number(price);
    const totalValueNum = totalValue != null ? Number(totalValue) : null;
    const userSatsNum = userSats != null ? Number(userSats) : null;
    const totalSatsNum = totalSats != null ? Number(totalSats) : null;
    const feeProtocolNum = feeProtocol != null ? Number(feeProtocol) : null;
    const feeLPNum = feeLP != null ? Number(feeLP) : null;

    // 🔥 FIX: optionIndex puede venir como string ("0"/"1")
    const optIdxNum = Number(optionIndex);

    // Validación básica
    if (
      !pollId ||
      !type ||
      !Number.isInteger(optIdxNum) ||
      !Number.isFinite(amtNum) ||
      !Number.isFinite(priceNum)
    ) {
      return res.status(400).json({ message: "Missing or invalid fields" });
    }

    if (type !== "buy" && type !== "sell") {
      return res.status(400).json({ message: "Invalid trade type" });
    }

    if (isOnChain) {
      const existingByTx = await Trade.findOne({ transactionHash: normalizedTxId });
      if (existingByTx) {
        return res.status(200).json({
          message: "Trade already indexed for txId",
          trade: existingByTx,
          idempotent: true,
        });
      }
    }

    // Poll existe y está activa
    const poll = await Poll.findById(pollId);
    if (!poll || !poll.isActive) {
      return res.status(404).json({ message: "Poll not found or inactive" });
    }

    // Opción válida
    if (optIdxNum < 0 || optIdxNum >= poll.options.length) {
      return res.status(400).json({ message: "Invalid option index" });
    }

    // amount mínimo
    if (amtNum <= 0) {
      return res.status(400).json({ message: "Amount must be greater than 0" });
    }

    // Off-chain: price ∈ [0,1]
    if (!isOnChain && (priceNum < 0 || priceNum > 1)) {
      return res.status(400).json({ message: "Invalid price (off-chain must be 0..1)" });
    }

    // On-chain: totalValue obligatorio y > 0
    if (isOnChain) {
      if (!Number.isFinite(totalValueNum) || totalValueNum <= 0) {
        return res
          .status(400)
          .json({ message: "Invalid totalValue for on-chain trade" });
      }
    }

    if (isOnChain) {
      const numFields = [
        { key: "userSats", val: userSatsNum },
        { key: "totalSats", val: totalSatsNum },
        { key: "feeProtocol", val: feeProtocolNum },
        { key: "feeLP", val: feeLPNum },
      ];
      for (const f of numFields) {
        if (f.val == null) continue;
        if (!Number.isFinite(f.val) || f.val < 0) {
          return res.status(400).json({ message: `Invalid ${f.key}` });
        }
      }
    }

    // Off-chain: comprobamos balance interno solo en buys
    if (type === "buy" && !isOnChain) {
      const totalCost = amtNum * priceNum; // unidades internas
      if (req.user.balance < totalCost) {
        return res.status(400).json({ message: "Insufficient balance" });
      }
    }

    // Creamos el trade
    const trade = new Trade({
      poll: pollId,
      user: req.user._id,
      type,
      optionIndex: optIdxNum,
      amount: amtNum,
      price: priceNum,
      priceSource: isOnChain ? "frontend_quote" : "offchain_orderbook",
      priceReliable: !isOnChain,
      totalValue: isOnChain ? totalValueNum : amtNum * priceNum,
      satsUser: isOnChain ? userSatsNum ?? null : null,
      satsTotal: isOnChain ? totalSatsNum ?? totalValueNum : null,
      feeProtocol: isOnChain ? feeProtocolNum ?? null : null,
      feeLP: isOnChain ? feeLPNum ?? null : null,
      orderType,
      remainingAmount: amtNum,
      isOnChain,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
    });

    let result;

    if (isOnChain) {
      // --- On-chain: el AMM ya ejecutó esto ---
      trade.status = "completed";
      trade.transactionHash = normalizedTxId;
      trade.chainSyncStatus = ONCHAIN_CHAIN_SYNC.CONFIRMED;
      trade.txAttachedAt = new Date();
      trade.txConfirmedAt = new Date();
      trade.filledAmount = amtNum;
      trade.remainingAmount = 0;

      await trade.save();

      // volumen por opción + % (solo si price en [0,1] lo tratamos como prob)
      await updateOptionVolume(pollId, optIdxNum, trade.amount, trade.price, {
        priceReliable: false,
        allowVolumeFallback: false,
      });
      await updatePollStatistics(pollId);
      await trySyncOnChainOdds(pollId);

      // solo contamos trade al usuario (balance real está on-chain)
      await User.findByIdAndUpdate(req.user._id, { $inc: { totalTrades: 1 } });

      result = trade;
    } else {
      // --- Off-chain: matching + balance interno ---
      await trade.save();
      result = await processTrade(trade, poll);

      await updateUserBalance(req.user._id, trade, result);
      await updatePollStatistics(pollId);
    }

    await emitTradeRealtime(req, result);

    res.status(201).json({
      message: "Trade executed successfully",
      trade: result,
    });
  } catch (error) {
    console.error("Create trade error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/trades/intents
 * Create on-chain trade intent (pre-Hiro)
 */
router.post("/intents", auth, async (req, res) => {
  try {
    const parsed = await parseOnChainTradePayload(req, { requireClientOperationId: true });
    if (parsed.error) {
      return res.status(parsed.error.status).json({ message: parsed.error.message });
    }

    const { data } = parsed;
    const existing = await Trade.findOne({
      user: req.user._id,
      clientOperationId: data.clientOperationId,
    });

    if (existing) {
      return res.status(200).json({
        message: "Trade intent already exists",
        trade: existing,
        idempotent: true,
      });
    }

    const trade = new Trade({
      poll: data.pollId,
      user: req.user._id,
      type: data.type,
      optionIndex: data.optionIndex,
      amount: data.amount,
      price: data.price,
      priceSource: "frontend_quote",
      priceReliable: false,
      totalValue: data.totalValue,
      satsUser: data.userSats ?? null,
      satsTotal: data.totalSats ?? data.totalValue,
      feeProtocol: data.feeProtocol ?? null,
      feeLP: data.feeLP ?? null,
      orderType: data.orderType || "market",
      filledAmount: 0,
      remainingAmount: data.amount,
      isOnChain: true,
      status: "pending",
      clientOperationId: data.clientOperationId,
      chainSyncStatus: ONCHAIN_CHAIN_SYNC.INTENT_CREATED,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
    });

    await trade.save();

    res.status(201).json({
      message: "Trade intent created",
      trade,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await Trade.findOne({
        user: req.user._id,
        clientOperationId: req.body?.clientOperationId,
      });
      if (existing) {
        return res.status(200).json({
          message: "Trade intent already exists",
          trade: existing,
          idempotent: true,
        });
      }
    }

    console.error("Create trade intent error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/trades/intents/:id/attach-tx
 * Link Hiro txId to an existing on-chain trade intent
 */
router.post("/intents/:id/attach-tx", auth, async (req, res) => {
  try {
    const trade = await Trade.findOne({ _id: req.params.id, user: req.user._id });
    if (!trade) return res.status(404).json({ message: "Trade intent not found" });
    if (!trade.isOnChain) return res.status(400).json({ message: "Trade is not on-chain" });

    const txId = normalizeTxId(req.body?.txId);
    if (!txId) return res.status(400).json({ message: "txId is required" });

    if (trade.status === "completed" && trade.transactionHash === txId) {
      return res.json({
        message: "Trade already completed",
        trade,
        idempotent: true,
      });
    }

    await attachTxToOnChainTrade(trade, txId);

    res.json({
      message: "txId attached to trade intent",
      trade,
    });
  } catch (error) {
    console.error("Attach tx to trade intent error:", error);
    res
      .status(error.statusCode || 500)
      .json({ message: error.message || "Server error" });
  }
});

/**
 * POST /api/trades/intents/:id/finalize
 * Finalize on-chain trade after tx status is known
 */
router.post("/intents/:id/finalize", auth, async (req, res) => {
  try {
    const trade = await Trade.findOne({ _id: req.params.id, user: req.user._id });
    if (!trade) return res.status(404).json({ message: "Trade intent not found" });
    if (!trade.isOnChain) return res.status(400).json({ message: "Trade is not on-chain" });

    const txId = normalizeTxId(req.body?.txId);
    const rawChainStatus = (req.body?.chainStatus || "").toString().toLowerCase().trim();
    const chainStatus = rawChainStatus === "failed" ? "failed" : "success";

    if (txId) {
      await attachTxToOnChainTrade(trade, txId);
    }

    if (chainStatus === "failed") {
      const failedTrade = await finalizeOnChainTradeFailure(
        trade,
        req.body?.failureReason || "On-chain transaction failed"
      );
      return res.json({
        message: "Trade marked as failed",
        trade: failedTrade,
      });
    }

    if (!trade.transactionHash) {
      return res.status(400).json({ message: "txId is required to finalize success" });
    }

    const wasCompleted = trade.status === "completed";
    if (wasCompleted) {
      return res.json({
        message: "Trade already finalized",
        trade,
        idempotent: true,
      });
    }

    try {
      await assertTxSenderMatchesAuthenticatedUser(trade.transactionHash, req.user.walletAddress);
    } catch (verifyError) {
      if (verifyError?.statusCode === 403) {
        const failedTrade = await finalizeOnChainTradeFailure(trade, verifyError.message);
        return res.status(403).json({
          message: verifyError.message,
          trade: failedTrade,
        });
      }
      throw verifyError;
    }

    const finalizedTrade = await finalizeOnChainTradeSuccess(req, trade);

    res.json({
      message: "Trade finalized successfully",
      trade: finalizedTrade,
      idempotent: false,
    });
  } catch (error) {
    console.error("Finalize trade intent error:", error);
    res
      .status(error.statusCode || 500)
      .json({ message: error.message || "Server error" });
  }
});

// @route GET /api/trades/poll/:pollId
// @desc Get trades for a specific poll
// @access Public
router.get("/poll/:pollId", async (req, res) => {
  try {
    const { pollId } = req.params;
    const { page = 1, limit = 50, optionIndex } = req.query;

    const query = { poll: pollId, status: "completed" };

    if (optionIndex !== undefined) {
      const optIdxNum = Number(optionIndex);
      if (Number.isInteger(optIdxNum)) query.optionIndex = optIdxNum;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const trades = await Trade.find(query)
      .populate("user", "username avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Trade.countDocuments(query);

    res.json({
      trades,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        total,
        hasNext: skip + trades.length < total,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("Get trades error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route GET /api/trades/me
// @desc Get authenticated user's personal trading history
// @access Private
router.get("/me", auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = { user: req.user._id };
    if (status) query.status = status;

    const trades = await Trade.find(query)
      .populate("poll")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);
    const total = await Trade.countDocuments(query);

    res.json({
      trades,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        total,
        hasNext: skip + trades.length < total,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("Get my trades error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route GET /api/trades/user
// @desc Get user's trading history (legacy alias of /me)
// @access Private
router.get("/user", auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = { user: req.user._id };
    if (status) query.status = status;

    const trades = await Trade.find(query)
      .populate("poll")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);
    const total = await Trade.countDocuments(query);

    res.json({
      trades,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        total,
        hasNext: skip + trades.length < total,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("Get user trades error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route GET /api/trades/orderbook/:pollId/:optionIndex
// @desc Get order book for a specific poll and option
// @access Public
router.get("/orderbook/:pollId/:optionIndex", async (req, res) => {
  try {
    const { pollId, optionIndex } = req.params;

    const optIdxNum = Number(optionIndex);
    if (!Number.isInteger(optIdxNum)) {
      return res.status(400).json({ message: "Invalid option index" });
    }

    const orderBook = await Trade.getOrderBook(pollId, optIdxNum);
    res.json(orderBook);
  } catch (error) {
    console.error("Get order book error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route DELETE /api/trades/:id
// @desc Cancel a pending trade
// @access Private
router.delete("/:id", auth, async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.id);

    if (!trade) return res.status(404).json({ message: "Trade not found" });

    if (trade.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (trade.status !== "pending") {
      return res.status(400).json({ message: "Trade cannot be cancelled" });
    }

    if (trade.isOnChain) {
      return res.status(400).json({ message: "On-chain trade intents cannot be cancelled here" });
    }

    trade.status = "cancelled";
    await trade.save();

    //  Importante:
    // Este backend NO reserva balance para órdenes off-chain pendientes (deduce solo al fill),
    // así que aquí NO se debe "refund" para evitar créditos indebidos.
    // On-chain nunca debería llegar aquí porque no existe orderbook on-chain.
    res.json({ message: "Trade cancelled successfully" });
  } catch (error) {
    console.error("Cancel trade error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------- HELPERS -----------------

async function processTrade(trade, poll) {
  try {
    if (trade.orderType === "market") {
      const matchingOrders = await findMatchingOrders(trade);

      if (matchingOrders.length > 0) {
        await executeMatchingTrades(trade, matchingOrders);
      } else {
        trade.status = "pending";
        await trade.save();
      }
    } else {
      trade.status = "pending";
      await trade.save();
    }

    return trade;
  } catch (error) {
    console.error("Process trade error:", error);
    throw error;
  }
}

async function findMatchingOrders(trade) {
  const oppositeType = trade.type === "buy" ? "sell" : "buy";
  const priceCondition =
    trade.type === "buy" ? { $lte: trade.price } : { $gte: trade.price };

  return await Trade.find({
    poll: trade.poll,
    optionIndex: trade.optionIndex,
    type: oppositeType,
    status: "pending",
    price: priceCondition,
  }).sort({ price: trade.type === "buy" ? 1 : -1, createdAt: 1 });
}

async function executeMatchingTrades(trade, matchingOrders) {
  let remainingAmount = trade.amount;

  for (const matchingOrder of matchingOrders) {
    if (remainingAmount <= 0) break;

    const tradeAmount = Math.min(remainingAmount, matchingOrder.remainingAmount);
    const tradePrice = matchingOrder.price;

    // ⚠️ Mantengo tu modelo original: se crea un "executedTrade" (fill) separado.
    // Si algún día quieres limpiar duplicidades/volumen, lo reestructuramos.
    const executedTrade = new Trade({
      poll: trade.poll,
      user: trade.user,
      type: trade.type,
      optionIndex: trade.optionIndex,
      amount: tradeAmount,
      price: tradePrice,
      totalValue: tradeAmount * tradePrice,
      status: "completed",
      orderType: "market",
      isOnChain: false,
    });

    await executedTrade.save();

    matchingOrder.filledAmount += tradeAmount;
    matchingOrder.remainingAmount -= tradeAmount;

    if (matchingOrder.remainingAmount <= 0) {
      matchingOrder.status = "completed";
    }

    await matchingOrder.save();

    await updateOptionVolume(trade.poll, trade.optionIndex, tradeAmount, tradePrice);

    remainingAmount -= tradeAmount;
  }

  trade.filledAmount = trade.amount - remainingAmount;
  trade.remainingAmount = remainingAmount;

  trade.status = remainingAmount <= 0 ? "completed" : "pending";
  await trade.save();
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

  // Solo binarios y si p est? en [0,1] lo tratamos como prob y movemos percentages
  // Si viene en 0-100 (percent), lo convertimos.
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


async function updateUserBalance(userId, trade) {
  const user = await User.findById(userId);
  if (!user) return;

  // On-chain: no tocar balance interno
  if (trade.transactionHash || trade.isOnChain) {
    user.totalTrades += 1;
    await user.save();
    return;
  }

  if (trade.type === "buy") {
    const cost = trade.filledAmount * trade.price;
    user.balance -= cost;
  } else {
    const revenue = trade.filledAmount * trade.price;
    user.balance += revenue;
  }

  user.totalTrades += 1;
  await user.save();
}

async function updatePollStatistics(pollId) {
  const poll = await Poll.findById(pollId);
  if (!poll) return;

  const trades = await Trade.find({ poll: pollId, status: "completed" });

  poll.totalVolume = trades.reduce(
    (sum, trade) => sum + (trade.totalValue || 0),
    0
  );
  poll.totalTrades = trades.length;

  const uniqueTraders = new Set(trades.map((trade) => trade.user.toString()));
  poll.uniqueTraders = uniqueTraders.size;

  await poll.save();
}

// ----------------- REDEEM & CLAIMED -----------------

router.post("/redeem", auth, async (req, res) => {
  try {
    const { pollId, txid } = req.body;
    if (!pollId) return res.status(400).json({ message: "pollId required" });
    const normalizedTxId = normalizeTxId(String(txid || ""));

    if (normalizedTxId) {
      await assertTxSenderMatchesAuthenticatedUser(normalizedTxId, req.user.walletAddress);
    }

    const trades = await Trade.find({
      poll: pollId,
      user: req.user._id,
      status: "completed",
      claimed: false,
    });

    if (!trades.length) {
      return res.status(202).json({
        message: "No backend rewards to mark",
        marked: 0,
        txid: normalizedTxId || null,
      });
    }

    const ids = trades.map((t) => t._id);
    await Trade.updateMany({ _id: { $in: ids } }, { $set: { claimed: true } });

    res.status(202).json({
      message: "Backend redeem sync accepted",
      marked: ids.length,
      txid: normalizedTxId || null,
    });
  } catch (err) {
    console.error("Redeem error:", err);
    res.status(err.statusCode || 500).json({ message: err.message || "Server error" });
  }
});

router.get("/claimed/:pollId", auth, async (req, res) => {
  try {
    const { pollId } = req.params;

    const claimed = await Trade.exists({
      poll: pollId,
      user: req.user._id,
      claimed: true,
    });

    res.json({ claimed: !!claimed });
  } catch (err) {
    console.error("Check claimed error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
