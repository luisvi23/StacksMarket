// routes/ladder.js
const express = require("express");
const LadderGroup = require("../models/LadderGroup");
const Poll = require("../models/Poll");
const Trade = require("../models/Trade");
const { adminAuth } = require("../middleware/auth");

const router = express.Router();

// ---------- ADMIN routes ----------

// @route   POST /api/ladder/groups
// @desc    Create a new ladder group in MongoDB (on-chain call handled by frontend)
// @access  Private (Admin)
router.post("/groups", adminAuth, async (req, res) => {
  try {
    const { groupId, title, resolutionSource, closeTime, image } = req.body;

    if (groupId == null || !title || !resolutionSource) {
      return res.status(400).json({
        message: "groupId, title, and resolutionSource are required",
      });
    }

    const numGroupId = Number(groupId);
    if (!Number.isFinite(numGroupId) || numGroupId <= 0) {
      return res.status(400).json({ message: "groupId must be a positive number" });
    }

    const existing = await LadderGroup.findOne({ groupId: numGroupId });
    if (existing) {
      return res.status(409).json({ message: "Ladder group with that groupId already exists" });
    }

    // Create a sentinel Poll used only as the comment thread anchor for this group
    const sentinelPoll = new Poll({
      title: String(title).trim(),
      description: String(resolutionSource || title).trim(),
      category: "Crypto",
      subCategory: "All",
      createdBy: req.user._id,
      options: [{ text: "Yes" }, { text: "No" }],
      endDate: closeTime ? new Date(Number(closeTime) * 1000) : new Date(Date.now() + 365 * 24 * 3600 * 1000),
      marketType: "ladder-comment",
    });
    await sentinelPoll.save();

    const group = new LadderGroup({
      groupId: Number(groupId),
      title: String(title).trim(),
      resolutionSource: String(resolutionSource).trim(),
      closeTime: closeTime ? new Date(Number(closeTime) * 1000) : null,
      image: image ? String(image).trim() : null,
      commentPollRef: sentinelPoll._id,
    });

    await group.save();

    res.status(201).json({ message: "Ladder group created", group });
  } catch (error) {
    console.error("Create ladder group error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/ladder/groups
// @desc    List all ladder groups with their polls populated
// @access  Private (Admin) AND Public (see duplicate below)
//
// NOTE: The public GET /:groupId is defined later and overlaps the admin list
// only in path length — no conflict.  This list route is admin-only.
router.get("/groups", adminAuth, async (req, res) => {
  try {
    const groups = await LadderGroup.find()
      .populate("polls")
      .sort({ createdAt: -1 });

    res.json({ groups });
  } catch (error) {
    console.error("List ladder groups error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/ladder/groups/:groupId/rungs
// @desc    Register a rung: creates a Poll for it and links it to the ladder group.
//          On-chain market creation (add-rung) is handled by the frontend before calling this.
// @access  Private (Admin)
router.post("/groups/:groupId/rungs", adminAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { marketId, label, addTxId, initialYesPct } = req.body;

    if (marketId == null || !label) {
      return res.status(400).json({
        message: "marketId and label are required",
      });
    }

    const numMarketId = Number(marketId);
    if (!Number.isFinite(numMarketId) || numMarketId <= 0) {
      return res.status(400).json({ message: "marketId must be a positive number" });
    }

    const trimmedLabel = String(label).trim();
    if (!trimmedLabel || trimmedLabel.length > 64) {
      return res.status(400).json({ message: "label must be 1-64 characters" });
    }

    if (initialYesPct != null) {
      const pct = Number(initialYesPct);
      if (!Number.isFinite(pct) || pct < 1 || pct > 99) {
        return res.status(400).json({ message: "initialYesPct must be between 1 and 99" });
      }
    }

    const group = await LadderGroup.findOne({ groupId: Number(groupId) });
    if (!group) {
      return res.status(404).json({ message: "Ladder group not found" });
    }

    // Create a Poll document for this rung
    const rungTitle = `${group.title} — ${trimmedLabel}`;

    const poll = new Poll({
      marketId: String(marketId),
      title: rungTitle,
      description: group.resolutionSource || "",
      category: "Crypto",
      subCategory: "All",
      createdBy: req.user._id,
      options: (() => {
        const yesPct = Number.isFinite(Number(initialYesPct)) ? Math.min(99, Math.max(1, Math.round(Number(initialYesPct)))) : 50;
        return [
          { text: "Yes", percentage: yesPct },
          { text: "No", percentage: 100 - yesPct },
        ];
      })(),
      endDate: group.closeTime || null,
      creationStatus: addTxId ? "pending" : "confirmed",
      createTxId: addTxId || null,
      marketType: "ladder",
      ladderGroupId: Number(groupId),
      ladderGroupRef: group._id,
      ladderLabel: trimmedLabel,
    });

    await poll.save();

    // Link poll to group
    group.polls.push(poll._id);
    await group.save();

    const updatedGroup = await LadderGroup.findOne({ groupId: Number(groupId) }).populate("polls");

    res.status(201).json({ message: "Rung registered", group: updatedGroup, poll });
  } catch (error) {
    console.error("Add rung error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/ladder/groups/:groupId/resolve
// @desc    Mark a ladder group as resolved by applying explicit per-rung outcomes
// @access  Private (Admin)
router.post("/groups/:groupId/resolve", adminAuth, async (req, res) => {
  const { groupId } = req.params;
  const { outcomes } = req.body;

  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return res.status(400).json({ message: "outcomes (non-empty array) is required" });
  }

  for (const item of outcomes) {
    if (!item || item.marketId == null || (item.outcome !== "YES" && item.outcome !== "NO")) {
      return res.status(400).json({
        message: "each outcome must be { marketId, outcome: 'YES' | 'NO' }",
      });
    }
  }

  try {
    const group = await LadderGroup.findOne({ groupId: Number(groupId) }).populate("polls");

    if (!group) {
      return res.status(404).json({ message: "Ladder group not found" });
    }
    if (group.status === "resolved") {
      return res.status(400).json({ message: "Ladder group is already resolved" });
    }

    group.status = "resolved";
    group.resolvedAt = new Date();
    await group.save();

    // Index polls by marketId for fast lookup
    const pollByMarketId = new Map();
    for (const poll of group.polls) {
      if (poll && poll.marketType === "ladder" && poll.marketId != null) {
        pollByMarketId.set(String(poll.marketId), poll);
      }
    }

    const rungResults = [];
    for (const { marketId, outcome } of outcomes) {
      const poll = pollByMarketId.get(String(marketId));
      if (!poll) continue;

      const winningOption = outcome === "YES" ? 0 : 1;
      poll.isResolved = true;
      poll.winningOption = winningOption;
      poll.isActive = false;
      await poll.save();

      rungResults.push({
        pollId: poll._id,
        marketId: poll.marketId,
        ladderLabel: poll.ladderLabel,
        outcome,
      });
    }

    // Emit live updates via socket.io
    const io = req.app.get("io");
    if (io) {
      for (const result of rungResults) {
        io.to(`poll-${result.pollId}`).emit("poll-resolved", {
          pollId: result.pollId,
          winningOption: result.outcome === "YES" ? 0 : 1,
        });
      }
    }

    res.json({
      message: "Ladder group resolved",
      group,
      rungResults,
    });
  } catch (error) {
    console.error("Resolve ladder group error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   PATCH /api/ladder/groups/:groupId/visibility
// @desc    Toggle whether a ladder group appears on the public site
// @access  Private (Admin)
router.patch("/groups/:groupId/visibility", adminAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { isPublic } = req.body;

    const group = await LadderGroup.findOneAndUpdate(
      { groupId: Number(groupId) },
      { isPublic: !!isPublic },
      { new: true }
    );
    if (!group) return res.status(404).json({ message: "Ladder group not found" });

    res.json({ message: "Visibility updated", isPublic: group.isPublic });
  } catch (error) {
    console.error("Visibility update error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- PUBLIC routes ----------

// @route   GET /api/ladder/public/groups
// @desc    Public listing of active ladder groups for Home page
// @access  Public
router.get("/public/groups", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 12, 50);
    const status = req.query.status || "active";

    const filter = status === "all" ? { isPublic: true } : { status, isPublic: true };
    const groups = await LadderGroup.find(filter)
      .populate({
        path: "polls",
        select: "marketId ladderLabel options totalVolume isResolved winningOption",
      })
      .sort({ createdAt: -1 })
      .limit(limit);

    const result = groups.map((g) => ({
      _id: g._id,
      groupId: g.groupId,
      title: g.title,
      resolutionSource: g.resolutionSource,
      image: g.image || null,
      closeTime: g.closeTime,
      status: g.status,
      rungs: (g.polls || []).map((poll) => {
        const yesOption = Array.isArray(poll.options) ? poll.options[0] : null;
        return {
          marketId: poll.marketId,
          label: poll.ladderLabel,
          probability: yesOption?.percentage ?? 50,
          volume: poll.totalVolume,
          isResolved: poll.isResolved,
          outcome: poll.isResolved ? (poll.winningOption === 0 ? "YES" : "NO") : null,
        };
      }),
    }));

    res.json({ groups: result });
  } catch (error) {
    console.error("Public ladder groups list error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/ladder/groups/:groupId
// @desc    Public view of a ladder group with all rungs, probabilities, and volumes
// @access  Public
router.get("/groups/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await LadderGroup.findOne({ groupId: Number(groupId) }).populate({
      path: "polls",
      select:
        "title marketId marketType ladderLabel " +
        "options totalVolume totalTrades isResolved winningOption endDate enabled",
    });

    if (!group) {
      return res.status(404).json({ message: "Ladder group not found" });
    }

    // Build rung summaries for the public response
    const rungs = (group.polls || []).map((poll) => {
      const yesOption = Array.isArray(poll.options) ? poll.options[0] : null;
      const noOption = Array.isArray(poll.options) ? poll.options[1] : null;
      return {
        pollId: poll._id,
        marketId: poll.marketId,
        label: poll.ladderLabel,
        probability: yesOption?.percentage ?? 50,
        noProbability: noOption?.percentage ?? 50,
        volume: poll.totalVolume,
        totalTrades: poll.totalTrades,
        isResolved: poll.isResolved,
        outcome: poll.isResolved ? (poll.winningOption === 0 ? "YES" : "NO") : null,
        endDate: poll.endDate,
      };
    });

    res.json({
      groupId: group.groupId,
      title: group.title,
      resolutionSource: group.resolutionSource,
      image: group.image || null,
      closeTime: group.closeTime,
      status: group.status,
      resolvedAt: group.resolvedAt,
      commentPollId: group.commentPollRef ? String(group.commentPollRef) : null,
      rungs,
    });
  } catch (error) {
    console.error("Get ladder group (public) error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/ladder/groups/:groupId/holders
// @desc    Top YES/NO holders aggregated across all rungs in a group
// @access  Public
router.get("/groups/:groupId/holders", async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await LadderGroup.findOne({ groupId: Number(groupId) });
    if (!group) return res.status(404).json({ message: "Ladder group not found" });

    const polls = await Poll.find({ ladderGroupId: Number(groupId) }).select("_id");
    if (!polls.length) return res.json({ holders: [] });

    const pollIds = polls.map((p) => p._id);

    const holders = await Trade.aggregate([
      { $match: { poll: { $in: pollIds }, status: "completed" } },
      {
        $group: {
          _id: { user: "$user", optionIndex: "$optionIndex" },
          netShares: {
            $sum: {
              $cond: [{ $eq: ["$type", "buy"] }, "$amount", { $multiply: ["$amount", -1] }],
            },
          },
        },
      },
      { $match: { netShares: { $gt: 0 } } },
      { $sort: { netShares: -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: "users",
          localField: "_id.user",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      {
        $project: {
          _id: 0,
          optionIndex: "$_id.optionIndex",
          netShares: 1,
          username: { $arrayElemAt: ["$userInfo.username", 0] },
          avatar: { $arrayElemAt: ["$userInfo.avatar", 0] },
          walletAddress: { $arrayElemAt: ["$userInfo.walletAddress", 0] },
        },
      },
    ]);

    res.json({ holders });
  } catch (error) {
    console.error("Ladder holders error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/ladder/groups/:groupId/trades
// @desc    Trade history for all rungs in a group (for probability chart + transactions tab)
// @access  Public
router.get("/groups/:groupId/trades", async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await LadderGroup.findOne({ groupId: Number(groupId) });
    if (!group) return res.status(404).json({ message: "Ladder group not found" });

    const polls = await Poll.find({ ladderGroupId: Number(groupId) })
      .select("_id marketId ladderLabel");

    if (!polls.length) return res.json({ trades: [] });

    const pollIds = polls.map((p) => p._id);

    const trades = await Trade.find({
      poll: { $in: pollIds },
      status: "completed",
    })
      .select("poll type optionIndex amount price createdAt")
      .sort({ createdAt: 1 })
      .limit(500);

    // Map poll ObjectId → rung metadata
    const pollMap = {};
    polls.forEach((p) => {
      pollMap[String(p._id)] = {
        marketId: p.marketId,
        label: p.ladderLabel,
      };
    });

    const result = trades.map((t) => {
      const info = pollMap[String(t.poll)] || {};
      const price = Number(t.price);
      // YES probability: optionIndex 0 = YES price directly, 1 = NO so invert
      const yesPct =
        t.type === "buy"
          ? t.optionIndex === 0
            ? Number.isFinite(price) ? Math.round(price * 100) : null
            : Number.isFinite(price) && price >= 0 && price <= 1
            ? Math.round((1 - price) * 100)
            : null
          : null; // sell trades don't update chart
      return {
        marketId: info.marketId,
        label: info.label,
        type: t.type,
        optionIndex: t.optionIndex,
        amount: t.amount,
        price: Number.isFinite(price) ? price : null,
        yesPct,
        createdAt: t.createdAt,
      };
    });

    res.json({ trades: result });
  } catch (error) {
    console.error("Ladder group trades error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
