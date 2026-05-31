// models/LadderGroup.js
const mongoose = require("mongoose");

const ladderGroupSchema = new mongoose.Schema(
  {
    groupId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    resolutionSource: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    image: {
      type: String,
      default: null,
    },
    closeTime: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      // "cancelled" = group was recovered/refunded (every rung settled NO and
      // its surplus withdrawn by the admin) — used for groups created by mistake
      // or left incomplete after a partial creation failure.
      enum: ["active", "resolving", "resolved", "cancelled"],
      default: "active",
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    // Cache of the winning rung after resolution (categorical market: exactly one rung wins)
    winningMarketId: {
      type: Number,
      default: null,
    },
    winningRungLabel: {
      type: String,
      default: null,
      maxlength: 64,
    },
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
    commentPollRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      default: null,
    },
    polls: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Poll",
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

ladderGroupSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("LadderGroup", ladderGroupSchema);
