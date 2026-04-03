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
      maxlength: 200,
    },
    resolutionSource: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    closeTime: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "resolving", "resolved"],
      default: "active",
    },
    finalValue: {
      type: Number,
      default: null,
    },
    resolvedAt: {
      type: Date,
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
