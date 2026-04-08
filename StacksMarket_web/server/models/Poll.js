// models/Poll.js
const mongoose = require("mongoose");

// ---------- helpers ----------
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function normalizeTo100(raw) {
  const vals = (raw || []).map((x) =>
    Number.isFinite(Number(x)) ? Number(x) : 0
  );
  const n = vals.length;
  if (!n) return [];

  const sum = vals.reduce((a, b) => a + b, 0);

  if (!Number.isFinite(sum) || sum <= 0) {
    const equal = 100 / n;
    return vals.map(() => equal);
  }

  const scale = 100 / sum;
  const out = vals.map((v) => clamp(v * scale, 0, 100));

  // Ajuste suave para que la suma sea exactamente 100 (por error flotante)
  const s2 = out.reduce((a, b) => a + b, 0);
  const diff = 100 - s2;
  if (Math.abs(diff) > 1e-9) {
    // mete el diff en el mayor para no romper clamping
    let idx = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[idx]) idx = i;
    out[idx] = clamp(out[idx] + diff, 0, 100);
  }

  return out;
}

function roundedTo100(normalized) {
  const n = normalized.length;
  if (!n) return [];
  if (n === 1) return [100];

  // binario: exacto y simple
  if (n === 2) {
    const a = clamp(Math.round(normalized[0]), 0, 100);
    return [a, 100 - a];
  }

  // n-ario: redondeo + corrección por fracciones
  const rounded = normalized.map((x) => clamp(Math.round(x), 0, 100));
  let diff = 100 - rounded.reduce((a, b) => a + b, 0);
  if (diff === 0) return rounded;

  const fracs = normalized
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort(diff > 0 ? (a, b) => b.frac - a.frac : (a, b) => a.frac - b.frac);

  let k = 0;
  while (diff !== 0 && k < fracs.length * 10) {
    const i = fracs[k % fracs.length].i;
    const next = rounded[i] + (diff > 0 ? 1 : -1);
    if (next >= 0 && next <= 100) {
      rounded[i] = next;
      diff += diff > 0 ? -1 : 1;
    }
    k++;
  }

  return rounded;
}

// ---------- schemas ----------
const optionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true,
  },
  //  UI principal (PollCard/PollDetail) prioriza "percentage"
  percentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  //  espejo entero 0–100 (útil para admin/odds, compat, etc)
  impliedProbability: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  totalVolume: {
    type: Number,
    default: 0,
  },
  totalTrades: {
    type: Number,
    default: 0,
  },
  image: {
    type: String,
    default: "",
  },
});

const pollSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Politics",
        "Trending",
        "Middle East",
        "Sports",
        "Crypto",
        "Tech",
        "Culture",
        "World",
        "Economy",
        "Elections",
        "Mentions",
      ],
    },
    subCategory: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      default: "",
    },
    options: [optionSchema],

    // Blockchain market id for tracking
    marketId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: null,
    },
    creationStatus: {
      type: String,
      enum: ["pending", "confirmed"],
      default: "confirmed",
    },
    createTxId: {
      type: String,
      default: null,
    },

    endDate: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isResolved: {
      type: Boolean,
      default: false,
    },
    winningOption: {
      type: Number,
      default: null,
    },
    totalVolume: {
      type: Number,
      default: 0,
    },
    totalTrades: {
      type: Number,
      default: 0,
    },
    uniqueTraders: {
      type: Number,
      default: 0,
    },
    rules: {
      type: String,
      default: "Standard prediction market rules apply.",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    featured: {
      type: Boolean,
      default: false,
    },
    trending: {
      type: Boolean,
      default: false,
    },

    // For sports polls
    team1: {
      name: String,
      logo: String,
      odds: Number,
    },
    team2: {
      name: String,
      logo: String,
      odds: Number,
    },
    matchTime: Date,
    sportType: String,

    // For crypto polls
    cryptoName: String,
    cryptoLogo: String,

    // For election polls
    country: String,
    countryFlag: String,
    candidates: [
      {
        name: String,
        image: String,
        percentage: Number,
        party: String,
      },
    ],

    // For location-based polls
    location: {
      country: String,
      state: String,
      city: String,
    },

    // Ladder / scalar market fields
    marketType: {
      type: String,
      enum: ["binary", "ladder", "ladder-comment"],
      default: "binary",
    },
    ladderGroupId: {
      type: Number,
      default: null,
    },
    ladderGroupRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LadderGroup",
      default: null,
    },
    // threshold stored as threshold * 100 to avoid float precision issues
    ladderThreshold: {
      type: Number,
      default: null,
    },
    ladderOperator: {
      type: String,
      enum: ["gte", "lte", null],
      default: null,
    },
    ladderLabel: {
      type: String,
      default: null,
    },

    // Has the market's reward been claimed (server-side flag)
    rewardClaimed: {
      type: Boolean,
      default: false,
    },

    // Last redeem transaction id (optional, for audit)
    lastRedeemTx: {
      type: String,
      default: null,
    },

    // Has the market's surplus been withdrawn (server-side flag)
    surplusWithdrawn: {
      type: Boolean,
      default: false,
    },

    // Last surplus withdraw transaction id (optional, for audit)
    surplusWithdrawTx: {
      type: String,
      default: null,
    },

    // Controls visibility on the public site
    enabled: {
      type: Boolean,
      default: false,
    },

    // Market management fields
    isPaused: {
      type: Boolean,
      default: false,
    },
    lastPauseTx: {
      type: String,
      default: null,
    },
    lastUnpauseTx: {
      type: String,
      default: null,
    },
    feeSettings: {
      protocolBps: { type: Number, default: null },
      lpBps: { type: Number, default: null },
      lastFeeTx: { type: String, default: null },
    },
    feeRecipients: {
      drip: { type: String, default: null },
      brc20: { type: String, default: null },
      team: { type: String, default: null },
      lp: { type: String, default: null },
      lastFeeRecipientTx: { type: String, default: null },
    },
    maxTradeLimit: {
      type: Number,
      default: null,
    },
    lastMaxTradeTx: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
pollSchema.index({ category: 1, subCategory: 1 });
pollSchema.index({ isActive: 1, endDate: 1 });
pollSchema.index({ trending: 1, totalVolume: -1 });
pollSchema.index({ featured: 1, createdAt: -1 });
pollSchema.index({ isResolved: 1, marketId: 1 });
pollSchema.index({ ladderGroupId: 1, marketType: 1 });

// Virtual for time remaining
pollSchema.virtual("timeRemaining").get(function () {
  if (this.isResolved) return 0;
  const now = new Date();
  const remaining = this.endDate - now;
  return remaining > 0 ? remaining : 0;
});

/**
 * updatePercentages
 *
 * Prioridad (nueva, consistente con tu flujo actual):
 * 1) Si hay percentage (>0) en alguna opción -> normaliza percentage y ESPEJA impliedProbability (0–100 int).
 * 2) Si no, si hay impliedProbability (>0) -> deriva percentage desde impliedProbability, y vuelve a espejar impliedProbability.
 * 3) Si no, fallback a totalVolume (shares) -> normaliza y espeja impliedProbability.
 */
pollSchema.methods.updatePercentages = function () {
  const opts = this.options || [];
  const n = opts.length;
  if (!n) return this.save();

  const hasPct = opts.some(
    (o) =>
      typeof o.percentage === "number" &&
      Number.isFinite(o.percentage) &&
      o.percentage > 0
  );

  const hasImplied = opts.some(
    (o) =>
      typeof o.impliedProbability === "number" &&
      Number.isFinite(o.impliedProbability) &&
      o.impliedProbability > 0
  );

  let normalized;

  if (hasPct) {
    const raw = opts.map((o) =>
      Number.isFinite(o.percentage) ? o.percentage : 0
    );
    normalized = normalizeTo100(raw);
  } else if (hasImplied) {
    const raw = opts.map((o) =>
      Number.isFinite(o.impliedProbability) ? o.impliedProbability : 0
    );
    normalized = normalizeTo100(raw);
  } else {
    const vols = opts.map((o) => Number(o.totalVolume) || 0);
    const sumVol = vols.reduce((a, b) => a + b, 0);
    if (sumVol > 0) {
      normalized = normalizeTo100(vols);
    } else {
      normalized = normalizeTo100(Array.from({ length: n }, () => 1));
    }
  }

  // aplicamos percentage (float) y impliedProbability (int sum=100)
  const impliedInts = roundedTo100(normalized);

  opts.forEach((o, i) => {
    o.percentage = clamp(normalized[i], 0, 100);
    o.impliedProbability = clamp(impliedInts[i], 0, 100);
  });

  return this.save();
};

// Method to check if poll is trending
pollSchema.methods.checkTrending = function () {
  const recentTrades = this.totalTrades;
  this.trending = recentTrades > 50; // Threshold for trending
  return this.save();
};

module.exports = mongoose.model("Poll", pollSchema);
