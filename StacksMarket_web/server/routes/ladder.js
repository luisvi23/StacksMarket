// routes/ladder.js
const express = require("express");
const mongoose = require("mongoose");
const LadderGroup = require("../models/LadderGroup");
const Poll = require("../models/Poll");
const { adminAuth } = require("../middleware/auth");

const router = express.Router();

// ---------- helpers ----------

/**
 * Given a stored finalValue and a rung's threshold/operator,
 * returns true if the rung resolves YES, false for NO.
 */
function computeRungOutcome(finalValue, threshold, operator) {
  if (finalValue == null || threshold == null || operator == null) return null;
  if (operator === "gte") return finalValue >= threshold;
  if (operator === "lte") return finalValue <= threshold;
  return null;
}

// ---------- ADMIN routes ----------

// @route   POST /api/ladder/groups
// @desc    Create a new ladder group in MongoDB (on-chain call handled by frontend)
// @access  Private (Admin)
router.post("/groups", adminAuth, async (req, res) => {
  try {
    const { groupId, title, resolutionSource, closeTime } = req.body;

    if (groupId == null || !title || !resolutionSource) {
      return res.status(400).json({
        message: "groupId, title, and resolutionSource are required",
      });
    }

    const existing = await LadderGroup.findOne({ groupId });
    if (existing) {
      return res.status(409).json({ message: "Ladder group with that groupId already exists" });
    }

    const group = new LadderGroup({
      groupId: Number(groupId),
      title: String(title).trim(),
      resolutionSource: String(resolutionSource).trim(),
      closeTime: closeTime ? new Date(closeTime) : null,
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
// @desc    Add a rung to a ladder group (links an existing Poll to the group)
// @access  Private (Admin)
router.post("/groups/:groupId/rungs", adminAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { marketId, threshold, operator, label, pollId } = req.body;

    if (marketId == null || threshold == null || !operator || !pollId) {
      return res.status(400).json({
        message: "marketId, threshold, operator, and pollId are required",
      });
    }

    if (!["gte", "lte"].includes(operator)) {
      return res.status(400).json({ message: "operator must be 'gte' or 'lte'" });
    }

    if (!mongoose.Types.ObjectId.isValid(pollId)) {
      return res.status(400).json({ message: "pollId is not a valid ObjectId" });
    }

    const group = await LadderGroup.findOne({ groupId: Number(groupId) });
    if (!group) {
      return res.status(404).json({ message: "Ladder group not found" });
    }

    const poll = await Poll.findById(pollId);
    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    // Update poll with ladder metadata
    poll.marketType = "ladder";
    poll.ladderGroupId = Number(groupId);
    poll.ladderGroupRef = group._id;
    poll.ladderThreshold = Number(threshold);
    poll.ladderOperator = operator;
    poll.ladderLabel = label ? String(label).trim() : null;
    if (marketId != null) {
      poll.marketId = String(marketId);
    }
    await poll.save();

    // Add poll to group if not already present
    const alreadyLinked = group.polls.some(
      (id) => String(id) === String(poll._id)
    );
    if (!alreadyLinked) {
      group.polls.push(poll._id);
      await group.save();
    }

    const updatedGroup = await LadderGroup.findOne({ groupId: Number(groupId) }).populate("polls");

    res.json({ message: "Rung added to ladder group", group: updatedGroup, poll });
  } catch (error) {
    console.error("Add rung error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/ladder/groups/:groupId/resolve
// @desc    Mark a ladder group as resolved and store the final value
// @access  Private (Admin)
router.post("/groups/:groupId/resolve", adminAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { finalValue } = req.body;

    if (finalValue == null) {
      return res.status(400).json({ message: "finalValue is required" });
    }

    const group = await LadderGroup.findOne({ groupId: Number(groupId) }).populate("polls");
    if (!group) {
      return res.status(404).json({ message: "Ladder group not found" });
    }

    if (group.status === "resolved") {
      return res.status(400).json({ message: "Ladder group is already resolved" });
    }

    const numericFinalValue = Number(finalValue);
    if (!Number.isFinite(numericFinalValue)) {
      return res.status(400).json({ message: "finalValue must be a finite number" });
    }

    group.finalValue = numericFinalValue;
    group.status = "resolved";
    group.resolvedAt = new Date();
    await group.save();

    // Determine each rung's outcome and update the linked polls
    const rungResults = [];
    for (const poll of group.polls) {
      if (!poll || poll.marketType !== "ladder") continue;

      const outcome = computeRungOutcome(
        numericFinalValue,
        poll.ladderThreshold,
        poll.ladderOperator
      );

      if (outcome !== null) {
        poll.isResolved = true;
        poll.winningOption = outcome ? 0 : 1; // 0 = YES, 1 = NO (binary options)
        poll.isActive = false;
        await poll.save();
      }

      rungResults.push({
        pollId: poll._id,
        marketId: poll.marketId,
        ladderLabel: poll.ladderLabel,
        ladderThreshold: poll.ladderThreshold,
        ladderOperator: poll.ladderOperator,
        outcome,
      });
    }

    // Emit live updates via socket.io
    const io = req.app.get("io");
    if (io) {
      for (const result of rungResults) {
        if (result.outcome !== null) {
          io.to(`poll-${result.pollId}`).emit("poll-resolved", {
            pollId: result.pollId,
            winningOption: result.outcome ? 0 : 1,
          });
        }
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

// @route   GET /api/ladder/groups/:groupId/rungs/:marketId/outcome
// @desc    Preview what a rung's outcome would be given the group's current stored finalValue
// @access  Private (Admin)
router.get("/groups/:groupId/rungs/:marketId/outcome", adminAuth, async (req, res) => {
  try {
    const { groupId, marketId } = req.params;

    const group = await LadderGroup.findOne({ groupId: Number(groupId) });
    if (!group) {
      return res.status(404).json({ message: "Ladder group not found" });
    }

    const poll = await Poll.findOne({ marketId: String(marketId) });
    if (!poll) {
      return res.status(404).json({ message: "Poll/rung not found for that marketId" });
    }

    if (String(poll.ladderGroupId) !== String(groupId)) {
      return res.status(400).json({ message: "Rung does not belong to this ladder group" });
    }

    const outcome = computeRungOutcome(
      group.finalValue,
      poll.ladderThreshold,
      poll.ladderOperator
    );

    res.json({
      groupId: group.groupId,
      finalValue: group.finalValue,
      marketId: poll.marketId,
      ladderLabel: poll.ladderLabel,
      ladderThreshold: poll.ladderThreshold,
      ladderOperator: poll.ladderOperator,
      outcome,
      outcomeLabel: outcome === null ? "unknown" : outcome ? "YES" : "NO",
    });
  } catch (error) {
    console.error("Rung outcome preview error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- PUBLIC route ----------

// @route   GET /api/ladder/groups/:groupId
// @desc    Public view of a ladder group with all rungs, probabilities, and volumes
// @access  Public
router.get("/groups/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await LadderGroup.findOne({ groupId: Number(groupId) }).populate({
      path: "polls",
      select:
        "title marketId marketType ladderThreshold ladderOperator ladderLabel " +
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
        ladderLabel: poll.ladderLabel,
        ladderThreshold: poll.ladderThreshold,
        ladderOperator: poll.ladderOperator,
        yesProbability: yesOption?.percentage ?? null,
        noProbability: noOption?.percentage ?? null,
        totalVolume: poll.totalVolume,
        totalTrades: poll.totalTrades,
        isResolved: poll.isResolved,
        winningOption: poll.winningOption,
        endDate: poll.endDate,
      };
    });

    res.json({
      groupId: group.groupId,
      title: group.title,
      resolutionSource: group.resolutionSource,
      closeTime: group.closeTime,
      status: group.status,
      finalValue: group.finalValue,
      resolvedAt: group.resolvedAt,
      rungs,
    });
  } catch (error) {
    console.error("Get ladder group (public) error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
