const mongoose = require('mongoose');

const marketConfigSchema = new mongoose.Schema(
  {
    paused: {
      type: Boolean,
      default: false,
    },
    lastTx: {
      type: String,
      default: null,
    },
    lastProcessedBlock: {
      type: Number,
      default: 0,
    },
    lastProcessedTxIndex: {
      type: Number,
      default: -1,
    },
    lastProcessedTxId: {
      type: String,
      default: null,
    },
    lastIndexedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MarketConfig', marketConfigSchema);
