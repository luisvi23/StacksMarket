// models/Trade.js
const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema(
  {
    poll: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["buy", "sell"],
      required: true,
    },
    optionIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    /**
     * price:
     * - Off-chain: se espera 0..1 (prob/price-style)
     * - On-chain: se guarda como metadata (puede ser 0..1 o lo que mande el front)
     *
     * IMPORTANTE: quitamos max:1 para no reventar si el front manda otro formato en on-chain.
     * La lógica que usa price como prob ya comprueba p>=0 && p<=1 antes de tocar percentages.
     */
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    priceSource: {
      type: String,
      enum: [
        "offchain_orderbook",
        "frontend_quote",
        "indexed_exact_total",
        "indexed_exact_from_events",
        "indexed_onchain_snapshot",
        "indexed_max_cost_bound",
        "indexed_min_proceeds_bound",
        "indexed_missing_total",
        "indexed_fallback_amount",
        "indexed_unknown",
      ],
      default: "offchain_orderbook",
    },
    priceReliable: {
      type: Boolean,
      default: true,
      index: true,
    },

    /**
     * totalValue:
     * - Off-chain: amount * price (unidades internas)
     * - On-chain: coste total on-chain (uSTX, lo manda el front)
     */
    totalValue: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["pending", "completed", "cancelled", "failed"],
      default: "pending",
    },

    // on-chain tx id
    transactionHash: {
      type: String,
      default: "",
    },

    // Idempotency key provided by the client for on-chain trade intents
    clientOperationId: {
      type: String,
      trim: true,
      default: undefined,
    },

    // Backend sync lifecycle for on-chain trades
    chainSyncStatus: {
      type: String,
      enum: ["none", "intent_created", "tx_submitted", "confirmed", "failed"],
      default: "none",
    },
    chainSyncError: {
      type: String,
      default: "",
    },
    txAttachedAt: {
      type: Date,
      default: null,
    },
    txConfirmedAt: {
      type: Date,
      default: null,
    },

    // bandera explícita (útil para queries/analytics)
    isOnChain: {
      type: Boolean,
      default: false,
      index: true,
    },

    fees: {
      type: Number,
      default: 0,
    },
    // On-chain uSTX breakdown (nullable for off-chain)
    satsUser: {
      type: Number,
      default: null,
      min: 0,
    },
    satsTotal: {
      type: Number,
      default: null,
      min: 0,
    },
    feeProtocol: {
      type: Number,
      default: null,
      min: 0,
    },
    feeLP: {
      type: Number,
      default: null,
      min: 0,
    },

    // For order book matching
    orderType: {
      type: String,
      enum: ["market", "limit"],
      default: "market",
    },

    // Solo para limit orders (off-chain). Prob-style 0..1
    limitPrice: {
      type: Number,
      min: 0,
      max: 1,
    },

    expiresAt: {
      type: Date,
    },

    // For partial fills
    filledAmount: {
      type: Number,
      default: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
    },

    // Payout / claim fields
    eligible: {
      type: Boolean,
      default: false,
    },
    claimed: {
      type: Boolean,
      default: false,
    },
    payoutAmount: {
      type: Number,
      default: 0,
    },

    // Metadata
    ipAddress: String,
    userAgent: String,
    notes: String,
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
tradeSchema.index({ poll: 1, createdAt: -1 });
tradeSchema.index({ user: 1, createdAt: -1 });
tradeSchema.index({ status: 1, createdAt: -1 });
tradeSchema.index({ type: 1, optionIndex: 1, price: 1 });
tradeSchema.index({ isOnChain: 1, priceReliable: 1, createdAt: -1 });
tradeSchema.index(
  { transactionHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionHash: { $type: "string", $ne: "" },
    },
  }
);
tradeSchema.index(
  { user: 1, clientOperationId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientOperationId: { $type: "string", $ne: "" },
    },
  }
);
tradeSchema.index({ isOnChain: 1, chainSyncStatus: 1, createdAt: -1 });
tradeSchema.index({ poll: 1, status: 1, createdAt: -1 });
tradeSchema.index({ poll: 1, priceSource: 1, createdAt: -1 });

// Pre-save hooks
tradeSchema.pre("save", function (next) {
  // Off-chain: si no hay tx on-chain, totalValue = amount * price (cuando se modifica)
  if (
    !this.transactionHash &&
    !this.isOnChain &&
    (this.isModified("amount") || this.isModified("price"))
  ) {
    this.totalValue = this.amount * this.price;
  }

  // remainingAmount depende de amount/filledAmount
  if (this.isModified("amount") || this.isModified("filledAmount")) {
    this.remainingAmount = this.amount - this.filledAmount;
  }

  next();
});

// Method to check if trade is valid
tradeSchema.methods.isValid = function () {
  return this.amount > 0 && this.price >= 0;
};

// Method to calculate profit/loss (solo orientativo)
tradeSchema.methods.calculatePnL = function (currentPrice) {
  if (this.type === "buy") {
    return (currentPrice - this.price) * this.amount;
  } else {
    return (this.price - currentPrice) * this.amount;
  }
};

// Static method to get order book for a poll
tradeSchema.statics.getOrderBook = async function (pollId, optionIndex) {
  const pendingTrades = await this.find({
    poll: pollId,
    optionIndex: optionIndex,
    status: "pending",
    orderType: "limit",
  }).sort({ price: 1, createdAt: 1 });

  const buyOrders = pendingTrades.filter((trade) => trade.type === "buy");
  const sellOrders = pendingTrades.filter((trade) => trade.type === "sell");

  return {
    buyOrders: buyOrders.slice(0, 10),
    sellOrders: sellOrders.slice(0, 10),
  };
};

// Static method to get trade history
tradeSchema.statics.getTradeHistory = async function (pollId, limit = 50) {
  return await this.find({
    poll: pollId,
    status: "completed",
  })
    .populate("user", "username avatar")
    .sort({ createdAt: -1 })
    .limit(limit);
};

module.exports = mongoose.model("Trade", tradeSchema);
