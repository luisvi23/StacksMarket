// routes/admin.js
const express = require("express");
const Poll = require("../models/Poll");
const User = require("../models/User");
const Trade = require("../models/Trade");
const Comment = require("../models/Comment");
const { adminAuth } = require("../middleware/auth");

const router = express.Router();

// ---------- helpers ----------
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function clampPct1to99(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return clamp(Math.round(n), 1, 99);
}

/**
 * normalizePercentagesInMemory (NO DB writes)
 *
 * Mantiene el mismo criterio que Poll.updatePercentages(), pero sin save():
 * 1) impliedProbability (>0) -> fuente principal (normalizado) -> copia a percentage
 * 2) percentage (>0) -> normaliza suma 100
 * 3) fallback a volumen -> normaliza suma 100
 */
function normalizePercentagesInMemory(poll) {
  if (!poll || !Array.isArray(poll.options)) return poll;

  const opts = poll.options;
  const n = opts.length;
  if (!n) return poll;

  const hasImplied = opts.some(
    (o) =>
      typeof o.impliedProbability === "number" &&
      Number.isFinite(o.impliedProbability) &&
      o.impliedProbability > 0
  );

  if (hasImplied) {
    const raw = opts.map((o) =>
      Number.isFinite(o.impliedProbability) ? o.impliedProbability : 0
    );
    const sum = raw.reduce((acc, v) => acc + v, 0);

    if (!Number.isFinite(sum) || sum <= 0) {
      const equal = 100 / n;
      opts.forEach((o) => {
        o.percentage = equal;
      });
    } else {
      opts.forEach((o, i) => {
        const pct = (raw[i] / sum) * 100;
        o.percentage = clamp(pct, 0, 100);
      });
    }
    return poll;
  }

  const hasExplicitPercentage = opts.some(
    (o) =>
      typeof o.percentage === "number" &&
      Number.isFinite(o.percentage) &&
      o.percentage > 0
  );

  if (hasExplicitPercentage) {
    const raw = opts.map((o) => (Number.isFinite(o.percentage) ? o.percentage : 0));
    const sum = raw.reduce((acc, v) => acc + v, 0);

    if (!Number.isFinite(sum) || sum <= 0) {
      const equal = 100 / n;
      opts.forEach((o) => {
        o.percentage = equal;
      });
    } else {
      opts.forEach((o, i) => {
        const pct = (raw[i] / sum) * 100;
        o.percentage = clamp(pct, 0, 100);
      });
    }
    return poll;
  }

  // fallback por volumen
  const vols = opts.map((o) => Number(o.totalVolume) || 0);
  const sumVol = vols.reduce((acc, v) => acc + v, 0);

  if (sumVol > 0) {
    opts.forEach((o, i) => {
      const pct = (vols[i] / sumVol) * 100;
      o.percentage = clamp(pct, 0, 100);
    });
  } else {
    const equal = 100 / n;
    opts.forEach((o) => {
      o.percentage = equal;
    });
  }

  return poll;
}

/**
 * Set YES/NO odds into poll.options (binary only) and keep DB consistent.
 * - writes impliedProbability and percentage
 * - runs updatePercentages() to normalize and persist once
 */
async function applyBinaryYesNoPctToPoll(poll, yesPct, noPct) {
  if (!poll || !Array.isArray(poll.options) || poll.options.length !== 2) {
    throw new Error("Only binary polls can update odds/bias");
  }

  const y0 = Number(yesPct);
  const n0 = Number(noPct);

  if (!Number.isFinite(y0) || !Number.isFinite(n0)) {
    throw new Error("Invalid odds");
  }
  if (y0 < 0 || y0 > 100 || n0 < 0 || n0 > 100) {
    throw new Error("Odds must be between 0 and 100");
  }
  if (y0 === 0 && n0 === 0) {
    throw new Error("Odds cannot both be 0");
  }

  // normaliza (por si llega 60/60 etc)
  const sum = y0 + n0;
  const y = (y0 / sum) * 100;
  const n = (n0 / sum) * 100;

  poll.options[0].impliedProbability = Math.round(y);
  poll.options[1].impliedProbability = Math.round(n);

  // también seteamos percentage, aunque updatePercentages lo volverá a alinear
  poll.options[0].percentage = y;
  poll.options[1].percentage = n;

  //  una sola escritura (updatePercentages hace save())
  await poll.updatePercentages();

  return poll;
}

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private (Admin)
router.get("/dashboard", adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalPolls = await Poll.countDocuments();
    const activePolls = await Poll.countDocuments({ isActive: true });
    const totalTrades = await Trade.countDocuments({ status: "completed" });
    const totalVolume = await Trade.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$totalValue" } } },
    ]);

    const recentPolls = await Poll.find()
      .populate("createdBy", "username")
      .sort({ createdAt: -1 })
      .limit(5);

    //  NO writes en GET: solo normaliza en memoria para devolver porcentajes coherentes
    recentPolls.forEach((p) => normalizePercentagesInMemory(p));

    const topUsers = await User.find()
      .sort({ totalTrades: -1 })
      .limit(10)
      .select("username totalTrades successfulTrades balance");

    const stats = {
      totalUsers,
      totalPolls,
      activePolls,
      totalTrades,
      totalVolume: totalVolume[0]?.total || 0,
      recentPolls,
      topUsers,
    };

    res.json(stats);
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/admin/polls
// @desc    Get all polls for admin management
// @access  Private (Admin)
router.get("/polls", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, category } = req.query;

    const query = { marketType: "binary" };
    if (status) query.isActive = status === "active";
    if (category) query.category = category;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const polls = await Poll.find(query)
      .populate("createdBy", "username email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Poll.countDocuments(query);

    //  NO writes en GET: coherencia en memoria (si impliedProbability existe, percentage queda alineado)
    polls.forEach((p) => normalizePercentagesInMemory(p));

    res.json({
      polls,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: skip + polls.length < total,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Admin get polls error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   PUT /api/admin/polls/:id
// @desc    Update poll as admin
// @access  Private (Admin)
router.put("/polls/:id", adminAuth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    const updatedPoll = await Poll.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("createdBy", "username email");

    //  mantener coherencia de percentages tras un update
    await updatedPoll.updatePercentages();

    // Emit live update to room
    const io = req.app.get("io");
    if (io) {
      io.to(`poll-${req.params.id}`).emit("poll-updated", {
        pollId: req.params.id,
        poll: updatedPoll,
      });
    }

    res.json({
      message: "Poll updated successfully",
      poll: updatedPoll,
    });
  } catch (error) {
    console.error("Admin update poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   DELETE /api/admin/polls/:id
// @desc    Delete poll as admin
// @access  Private (Admin)
router.delete("/polls/:id", adminAuth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    // Hard delete the poll
    await Poll.findByIdAndDelete(req.params.id);

    // Also delete related trades and comments
    await Trade.deleteMany({ poll: req.params.id });
    await Comment.deleteMany({ poll: req.params.id });

    res.json({ message: "Poll deleted successfully" });
  } catch (error) {
    console.error("Admin delete poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/admin/polls/:id/resolve
// @desc    Resolve a poll as admin
// @access  Private (Admin)
router.post("/polls/:id/resolve", adminAuth, async (req, res) => {
  try {
    const { winningOption } = req.body;

    if (winningOption === undefined) {
      return res.status(400).json({ message: "Winning option is required" });
    }

    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    if (poll.isResolved) {
      return res.status(400).json({ message: "Poll is already resolved" });
    }

    if (winningOption < 0 || winningOption >= poll.options.length) {
      return res.status(400).json({ message: "Invalid winning option" });
    }

    poll.isResolved = true;
    poll.winningOption = winningOption;
    poll.isActive = false;

    await poll.save();

    // Mark winning trades as eligible for claim and set payout amounts
    await markWinningTradesEligible(poll);

    // Emit live resolve to room
    const io = req.app.get("io");
    if (io) {
      io.to(`poll-${req.params.id}`).emit("poll-resolved", {
        pollId: req.params.id,
        winningOption: poll.winningOption,
        poll,
      });
    }

    res.json({
      message: "Poll resolved successfully",
      poll,
    });
  } catch (error) {
    console.error("Admin resolve poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/admin/polls/:id/withdraw-surplus
// @desc    Mark surplus withdrawn for a poll (admin)
// @access  Private (Admin)
router.post("/polls/:id/withdraw-surplus", adminAuth, async (req, res) => {
  try {
    const { txid } = req.body;
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ message: "Poll not found" });

    if (poll.surplusWithdrawn) {
      return res.status(400).json({ message: "Surplus already withdrawn" });
    }

    poll.surplusWithdrawn = true;
    if (txid) poll.surplusWithdrawTx = txid;
    await poll.save();

    // Emit live update
    const io = req.app.get("io");
    if (io) {
      io.to(`poll-${req.params.id}`).emit("poll-updated", {
        pollId: req.params.id,
        poll,
      });
    }

    res.json({ message: "Surplus marked withdrawn", poll });
  } catch (error) {
    console.error("Admin withdraw surplus error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users for admin management
// @access  Private (Admin)
router.get("/users", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    const query = {};
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { walletAddress: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const users = await User.find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: skip + users.length < total,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Admin get users error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   PUT /api/admin/users/:id
// @desc    Update user as admin
// @access  Private (Admin)
router.put("/users/:id", adminAuth, async (req, res) => {
  try {
    const { balance, isAdmin, isBanned } = req.body;

    const updateData = {};
    if (balance !== undefined) updateData.balance = balance;
    if (isAdmin !== undefined) updateData.isAdmin = isAdmin;
    if (isBanned !== undefined) updateData.isBanned = isBanned;

    const user = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    console.error("Admin update user error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete user as admin
// @access  Private (Admin)
router.delete("/users/:id", adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Delete user and all related data
    await User.findByIdAndDelete(req.params.id);
    await Trade.deleteMany({ user: req.params.id });
    await Comment.deleteMany({ user: req.params.id });

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Admin delete user error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/admin/trades
// @desc    Get all trades for admin monitoring
// @access  Private (Admin)
router.get("/trades", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, pollId } = req.query;

    const query = {};
    if (status) query.status = status;
    if (pollId) query.poll = pollId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const trades = await Trade.find(query)
      .populate("user", "username email")
      .populate("poll", "title category")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Trade.countDocuments(query);

    res.json({
      trades,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: skip + trades.length < total,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Admin get trades error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/admin/comments
// @desc    Get flagged comments for moderation
// @access  Private (Admin)
router.get("/comments", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, flagged } = req.query;

    const query = {};
    if (flagged === "true") {
      query.isFlagged = true;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const comments = await Comment.find(query)
      .populate("user", "username email")
      .populate("poll", "title category")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Comment.countDocuments(query);

    res.json({
      comments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: skip + comments.length < total,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Admin get comments error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/admin/comments/:id/moderate
// @desc    Moderate a comment
// @access  Private (Admin)
router.post("/comments/:id/moderate", adminAuth, async (req, res) => {
  try {
    const { action } = req.body; // 'approve', 'delete', 'warn'

    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    switch (action) {
      case "approve":
        comment.isFlagged = false;
        comment.flaggedBy = [];
        break;
      case "delete":
        await comment.softDelete();
        break;
      case "warn":
        comment.notes = "Comment flagged by admin for review";
        break;
      default:
        return res.status(400).json({ message: "Invalid action" });
    }

    await comment.save();

    res.json({
      message: `Comment ${action}ed successfully`,
      comment,
    });
  } catch (error) {
    console.error("Admin moderate comment error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Helper function to process poll payouts
async function processPollPayouts(poll) {
  try {
    const trades = await Trade.find({ poll: poll._id, status: "completed" });

    for (const trade of trades) {
      const user = await User.findById(trade.user);
      if (!user) continue;

      if (trade.optionIndex === poll.winningOption) {
        const payout = trade.amount;
        user.balance += payout;
        user.successfulTrades += 1;
      }

      await user.save();
    }
  } catch (error) {
    console.error("Process poll payouts error:", error);
  }
}

// Mark trades on winning option as eligible for claim and compute payouts
async function markWinningTradesEligible(poll) {
  try {
    const trades = await Trade.find({ poll: poll._id, status: "completed" });

    for (const trade of trades) {
      if (trade.optionIndex === poll.winningOption) {
        trade.eligible = true;
        trade.payoutAmount = trade.amount; // simple 1x payout
      } else {
        trade.eligible = false;
        trade.payoutAmount = 0;
      }
      await trade.save();
    }
  } catch (err) {
    console.error("Mark winning trades eligible error:", err);
  }
}

// @route   POST /api/admin/market/:marketId/pause
// @desc    Pause a specific market (DB flag + txid audit)
// @access  Private (Admin)
router.post("/market/:marketId/pause", adminAuth, async (req, res) => {
  try {
    const { marketId } = req.params;
    const { txid } = req.body;

    const poll = await Poll.findOneAndUpdate(
      { marketId },
      {
        $set: {
          isPaused: true,
          lastPauseTx: txid,
        },
      },
      { new: true }
    );

    if (!poll) {
      return res.status(404).json({ message: "Market not found" });
    }

    res.json({ message: "Market paused successfully", poll });
  } catch (error) {
    console.error("Pause market error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/admin/market/:marketId/unpause
// @desc    Unpause a specific market (DB flag + txid audit)
// @access  Private (Admin)
router.post("/market/:marketId/unpause", adminAuth, async (req, res) => {
  try {
    const { marketId } = req.params;
    const { txid } = req.body;

    const poll = await Poll.findOneAndUpdate(
      { marketId },
      {
        $set: {
          isPaused: false,
          lastUnpauseTx: txid,
        },
      },
      { new: true }
    );

    if (!poll) {
      return res.status(404).json({ message: "Market not found" });
    }

    res.json({ message: "Market unpaused successfully", poll });
  } catch (error) {
    console.error("Unpause market error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/admin/market/:marketId/set-max-trade
// @desc    Set max trade for a specific market (uSTX total per tx)
// @access  Private (Admin)
router.post("/market/:marketId/set-max-trade", adminAuth, async (req, res) => {
  try {
    const { marketId } = req.params;
    const { limit, txid } = req.body;

    const poll = await Poll.findOneAndUpdate(
      { marketId },
      {
        $set: {
          maxTradeLimit: limit,
          lastMaxTradeTx: txid,
        },
      },
      { new: true }
    );

    if (!poll) {
      return res.status(404).json({ message: "Market not found" });
    }

    res.json({ message: "Max trade set successfully", poll });
  } catch (error) {
    console.error("Set max trade error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 *  NEW (v9-bias)
 * @route   POST /api/admin/market/:marketId/set-bias
 * @desc    Record initial bias in DB by writing YES/NO impliedProbability + percentage (binary only)
 * @access  Private (Admin)
 *
 * body: { pYes, txid? } where pYes is 1..99
 */
router.post("/market/:marketId/set-bias", adminAuth, async (req, res) => {
  try {
    const { marketId } = req.params;
    const { pYes, txid } = req.body;

    const p = clampPct1to99(pYes);
    if (p == null) {
      return res.status(400).json({ message: "Invalid pYes" });
    }

    const poll = await Poll.findOne({ marketId });
    if (!poll) return res.status(404).json({ message: "Market not found" });

    if (!Array.isArray(poll.options) || poll.options.length !== 2) {
      return res
        .status(400)
        .json({ message: "Only binary markets can set bias" });
    }

    const yes = p;
    const no = 100 - p;

    const updated = await applyBinaryYesNoPctToPoll(poll, yes, no);

    // Emit live update
    const io = req.app.get("io");
    if (io) {
      io.to(`poll-${updated._id}`).emit("poll-updated", {
        pollId: updated._id,
        poll: updated,
        meta: { action: "set-bias", txid: txid || null },
      });
    }

    res.json({
      message: "Bias recorded in DB (options updated)",
      marketId,
      txid: txid || null,
      yesPct: yes,
      noPct: no,
      poll: updated,
    });
  } catch (error) {
    console.error("Set bias error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 *  LEGACY compat
 * @route   POST /api/admin/market/:marketId/set-virtual-prior
 * @desc    Backward compatible endpoint: accepts virtualYes/virtualNo and converts to pYes by ratio
 * @access  Private (Admin)
 *
 * body: { virtualYes, virtualNo, txid? }
 * NOTE: mapping is ratio-based (not sigmoid/b) because backend doesn't read b on-chain.
 */
router.post("/market/:marketId/set-virtual-prior", adminAuth, async (req, res) => {
  try {
    const { marketId } = req.params;
    const { virtualYes, virtualNo, txid } = req.body;

    const vY = Number(virtualYes);
    const vN = Number(virtualNo);
    if (!Number.isFinite(vY) || !Number.isFinite(vN) || vY < 0 || vN < 0) {
      return res.status(400).json({ message: "Invalid virtual prior values" });
    }

    const sum = vY + vN;
    let pYes = 50;
    if (sum > 0) pYes = Math.round((vY / sum) * 100);

    // clamp 1..99 to match v8
    pYes = clamp(pYes, 1, 99);

    const poll = await Poll.findOne({ marketId });
    if (!poll) return res.status(404).json({ message: "Market not found" });

    if (!Array.isArray(poll.options) || poll.options.length !== 2) {
      return res
        .status(400)
        .json({ message: "Only binary markets can set virtual prior" });
    }

    const yes = pYes;
    const no = 100 - pYes;

    const updated = await applyBinaryYesNoPctToPoll(poll, yes, no);

    // Emit live update
    const io = req.app.get("io");
    if (io) {
      io.to(`poll-${updated._id}`).emit("poll-updated", {
        pollId: updated._id,
        poll: updated,
        meta: { action: "set-virtual-prior", txid: txid || null },
      });
    }

    res.json({
      message: "Virtual prior recorded in DB (compat)",
      marketId,
      txid: txid || null,
      yesPct: yes,
      noPct: no,
      poll: updated,
    });
  } catch (error) {
    console.error("Set virtual prior (legacy) error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
