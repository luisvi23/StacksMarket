const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      trim: true,
    },
    username: {
      type: String,
      required: false,
      trim: true,
      minlength: 3,
      maxlength: 100,
    },
    avatar: {
      type: String,
      default: "",
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    balance: {
      type: Number,
      default: 1000,
    },
    totalTrades: {
      type: Number,
      default: 0,
    },
    successfulTrades: {
      type: Number,
      default: 0,
    },
    savedPolls: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Poll",
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", function (next) {
  if (!this.walletAddress) {
    return next(new Error("Wallet address is required"));
  }
  next();
});

module.exports = mongoose.model("User", userSchema);
