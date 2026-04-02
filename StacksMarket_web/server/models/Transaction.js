const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    txid: {
      type: String,
      required: true,
      trim: true,
    },
    network: {
      type: String,
      enum: ["mainnet", "testnet"],
      default: "mainnet",
      index: true,
    },
    status: {
      type: String,
      default: "pending",
      index: true,
    },
    blockHeight: {
      type: Number,
      default: null,
      index: true,
    },
    txIndex: {
      type: Number,
      default: 0,
      index: true,
    },
    blockTime: {
      type: Date,
      default: null,
    },
    contractId: {
      type: String,
      default: "",
      index: true,
    },
    functionName: {
      type: String,
      default: "",
      index: true,
    },
    kind: {
      type: String,
      enum: [
        "buy",
        "sell",
        "redeem",
        "resolve",
        "admin",
        "unknown",
      ],
      default: "unknown",
      index: true,
    },
    marketId: {
      type: String,
      default: "",
      index: true,
    },
    poll: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      default: null,
      index: true,
    },
    walletAddress: {
      type: String,
      default: "",
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    optionIndex: {
      type: Number,
      default: null,
    },
    amount: {
      type: Number,
      default: null,
    },
    totalValue: {
      type: Number,
      default: null,
    },
    txResultRepr: {
      type: String,
      default: "",
    },
    rawArgs: {
      type: [String],
      default: [],
    },
    source: {
      type: String,
      default: "hiro-indexer",
    },
    syncedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

transactionSchema.index({ txid: 1 }, { unique: true });
transactionSchema.index({ marketId: 1, blockHeight: -1, txIndex: -1 });
transactionSchema.index({ poll: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
