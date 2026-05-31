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
  let sentinelPoll = null;
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
    sentinelPoll = new Poll({
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

    // Cleanup orphaned sentinel poll if group creation failed after it was saved
    if (sentinelPoll && sentinelPoll._id) {
      try {
        await Poll.deleteOne({ _id: sentinelPoll._id });
      } catch (cleanupErr) {
        console.error("Failed to cleanup orphaned sentinel poll:", cleanupErr);
      }
    }

    // Surface Mongoose validation errors so admin can act on them
    if (error && error.name === "ValidationError") {
      const fields = Object.entries(error.errors || {})
        .map(([k, v]) => `${k}: ${v.message}`)
        .join("; ");
      return res.status(400).json({ message: `Validation error: ${fields}` });
    }

    res.status(500).json({ message: error?.message || "Server error" });
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
    const { marketId, label, addTxId, initialYesPct, image } = req.body;

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

    const trimmedImage =
      typeof image === "string" && image.trim() ? image.trim() : "";

    const poll = new Poll({
      marketId: String(marketId),
      title: rungTitle,
      description: group.resolutionSource || "",
      category: "Crypto",
      subCategory: "All",
      image: trimmedImage,
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

  // Detect duplicate marketIds
  const seenMarketIds = new Set();
  for (const item of outcomes) {
    if (!item || item.marketId == null || (item.outcome !== "YES" && item.outcome !== "NO")) {
      return res.status(400).json({
        message: "each outcome must be { marketId, outcome: 'YES' | 'NO' }",
      });
    }
    const key = String(item.marketId);
    if (seenMarketIds.has(key)) {
      return res.status(400).json({ message: `duplicate marketId in outcomes: ${key}` });
    }
    seenMarketIds.add(key);
  }

  // Categorical market rule: exactly one rung must be the winner (YES)
  const yesCount = outcomes.filter((o) => o.outcome === "YES").length;
  if (yesCount !== 1) {
    return res.status(400).json({
      message: `exactly 1 rung must be YES, got ${yesCount} (categorical market rule)`,
    });
  }

  try {
    const group = await LadderGroup.findOne({ groupId: Number(groupId) }).populate("polls");

    if (!group) {
      return res.status(404).json({ message: "Ladder group not found" });
    }
    if (group.status === "resolved") {
      return res.status(400).json({ message: "Ladder group is already resolved" });
    }

    // Index polls by marketId for fast lookup
    const pollByMarketId = new Map();
    for (const poll of group.polls) {
      if (poll && poll.marketType === "ladder" && poll.marketId != null) {
        pollByMarketId.set(String(poll.marketId), poll);
      }
    }

    // Validate that every rung in the group has a corresponding outcome
    const expectedMarketIds = new Set(pollByMarketId.keys());
    const providedMarketIds = new Set(outcomes.map((o) => String(o.marketId)));
    const missing = [...expectedMarketIds].filter((id) => !providedMarketIds.has(id));
    if (missing.length > 0) {
      return res.status(400).json({
        message: `missing outcomes for rungs: ${missing.join(", ")}`,
      });
    }
    // Reject outcomes for rungs not in this group
    const unknown = [...providedMarketIds].filter((id) => !expectedMarketIds.has(id));
    if (unknown.length > 0) {
      return res.status(400).json({
        message: `unknown rungs not part of this group: ${unknown.join(", ")}`,
      });
    }

    // Apply outcomes — cache the winning rung on the group document
    const rungResults = [];
    let winningMarketId = null;
    let winningRungLabel = null;
    for (const { marketId, outcome } of outcomes) {
      const poll = pollByMarketId.get(String(marketId));
      if (!poll) continue;

      const winningOption = outcome === "YES" ? 0 : 1;
      poll.isResolved = true;
      poll.winningOption = winningOption;
      poll.isActive = false;
      await poll.save();

      if (outcome === "YES") {
        winningMarketId = Number(poll.marketId);
        winningRungLabel = poll.ladderLabel || null;
      }

      rungResults.push({
        pollId: poll._id,
        marketId: poll.marketId,
        ladderLabel: poll.ladderLabel,
        outcome,
      });
    }

    group.status = "resolved";
    group.resolvedAt = new Date();
    group.winningMarketId = winningMarketId;
    group.winningRungLabel = winningRungLabel;
    await group.save();

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

// @route   POST /api/ladder/groups/:groupId/rungs/:marketId/resolve
// @desc    Resolve a single rung independently (YES or NO).
//          Other rungs remain tradeable until each is resolved one by one.
//          Multiple YES winners are allowed (the group stores the first one
//          on winningMarketId/winningRungLabel; the rest live on the Poll docs).
// @access  Private (Admin)
router.post(
  "/groups/:groupId/rungs/:marketId/resolve",
  adminAuth,
  async (req, res) => {
    try {
      const { groupId, marketId } = req.params;
      const { outcome, txId } = req.body;

      if (outcome !== "YES" && outcome !== "NO") {
        return res.status(400).json({ message: "outcome must be 'YES' or 'NO'" });
      }

      const g = Number(groupId);
      if (!Number.isFinite(g) || g <= 0) {
        return res.status(400).json({ message: "groupId must be a positive number" });
      }

      const group = await LadderGroup.findOne({ groupId: g }).populate("polls");
      if (!group) {
        return res.status(404).json({ message: "Ladder group not found" });
      }
      if (group.status === "resolved") {
        return res.status(400).json({ message: "Ladder group is already fully resolved" });
      }

      const poll = (group.polls || []).find(
        (p) =>
          p &&
          p.marketType === "ladder" &&
          p.marketId != null &&
          String(p.marketId) === String(marketId)
      );
      if (!poll) {
        return res.status(404).json({ message: "Rung not found in this group" });
      }
      if (poll.isResolved) {
        return res.status(400).json({ message: "Rung already resolved" });
      }

      // Apply resolution to the rung
      poll.isResolved = true;
      poll.isActive = false;
      poll.winningOption = outcome === "YES" ? 0 : 1;
      await poll.save();

      // Promote group state — first resolved rung moves it from active to resolving
      if (group.status === "active") {
        group.status = "resolving";
      }

      // Record the first YES winner on the group doc; additional YES winners
      // (multi-winner case) live on their own Poll docs and are derived at read time.
      if (outcome === "YES" && !group.winningMarketId) {
        group.winningMarketId = Number(poll.marketId);
        group.winningRungLabel = poll.ladderLabel || null;
      }

      // If every ladder rung is now resolved, close the group
      const ladderRungs = (group.polls || []).filter(
        (p) => p && p.marketType === "ladder"
      );
      const allResolved =
        ladderRungs.length > 0 && ladderRungs.every((p) => p.isResolved);
      if (allResolved) {
        group.status = "resolved";
        group.resolvedAt = new Date();
      }

      await group.save();

      // Live update for any open viewer of this rung
      const io = req.app.get("io");
      if (io) {
        io.to(`poll-${poll._id}`).emit("poll-resolved", {
          pollId: poll._id,
          winningOption: poll.winningOption,
        });
      }

      res.json({
        message: "Rung resolved",
        group: {
          groupId: group.groupId,
          status: group.status,
          winningMarketId: group.winningMarketId ?? null,
          winningRungLabel: group.winningRungLabel ?? null,
          resolvedAt: group.resolvedAt,
        },
        rung: {
          pollId: poll._id,
          marketId: poll.marketId,
          label: poll.ladderLabel,
          outcome,
          txId: txId || null,
        },
      });
    } catch (error) {
      console.error("Resolve single rung error:", error);
      if (error && error.name === "ValidationError") {
        const fields = Object.entries(error.errors || {})
          .map(([k, v]) => `${k}: ${v.message}`)
          .join("; ");
        return res.status(400).json({ message: `Validation error: ${fields}` });
      }
      res.status(500).json({ message: error?.message || "Server error" });
    }
  }
);

// @route   POST /api/ladder/groups/:groupId/recover
// @desc    Mark a group (and the given rungs) as recovered/cancelled after the
//          admin has settled every rung NO and withdrawn its surplus on-chain.
//          Used to refund a group created by mistake or left incomplete by a
//          partial creation failure — so no STX stays stuck in the contract.
// @access  Private (Admin)
router.post("/groups/:groupId/recover", adminAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { resolvedMarketIds } = req.body;

    const g = Number(groupId);
    if (!Number.isFinite(g) || g <= 0) {
      return res.status(400).json({ message: "groupId must be a positive number" });
    }

    const group = await LadderGroup.findOne({ groupId: g }).populate("polls");
    if (!group) {
      return res.status(404).json({ message: "Ladder group not found" });
    }

    // Settle any rung the admin refunded (default: all ladder rungs) as NO.
    const targetIds =
      Array.isArray(resolvedMarketIds) && resolvedMarketIds.length
        ? new Set(resolvedMarketIds.map((x) => String(x)))
        : null;

    const ladderRungs = (group.polls || []).filter((p) => p && p.marketType === "ladder");
    for (const poll of ladderRungs) {
      if (targetIds && !targetIds.has(String(poll.marketId))) continue;
      if (!poll.isResolved) {
        poll.isResolved = true;
        poll.isActive = false;
        poll.winningOption = 1; // NO — refund path leaves no winner
        await poll.save();
      }
    }

    group.status = "cancelled";
    group.resolvedAt = group.resolvedAt || new Date();
    group.winningMarketId = null;
    group.winningRungLabel = null;
    await group.save();

    const io = req.app.get("io");
    if (io) {
      for (const poll of ladderRungs) {
        io.to(`poll-${poll._id}`).emit("poll-resolved", {
          pollId: poll._id,
          winningOption: 1,
        });
      }
    }

    res.json({
      message: "Ladder group recovered (cancelled)",
      group: {
        groupId: group.groupId,
        status: group.status,
        resolvedAt: group.resolvedAt,
      },
    });
  } catch (error) {
    console.error("Recover ladder group error:", error);
    res.status(500).json({ message: error?.message || "Server error" });
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

    // "active" includes "resolving" groups too — a group with some rungs
    // already resolved but others still tradeable should keep showing up on
    // the public active markets list. Only "resolved" (all rungs settled)
    // graduates it out.
    const filter =
      status === "all"
        ? { isPublic: true }
        : status === "active"
        ? { status: { $in: ["active", "resolving"] }, isPublic: true }
        : { status, isPublic: true };
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
      winningMarketId: g.winningMarketId ?? null,
      winningRungLabel: g.winningRungLabel ?? null,
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
        "title marketId marketType ladderLabel image " +
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
        image: poll.image || null,
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
      winningMarketId: group.winningMarketId ?? null,
      winningRungLabel: group.winningRungLabel ?? null,
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
