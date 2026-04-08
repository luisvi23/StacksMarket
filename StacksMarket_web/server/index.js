const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const http = require("http");
const socketIo = require("socket.io");
const { createOnChainTradeReconciler } = require("./jobs/onChainTradeReconciler");
const { createOnChainTransactionIndexer, repairTradePricesForPoll } = require("./jobs/onChainTransactionIndexer");
const { syncAllActiveMarkets, syncLadderGroup } = require("./utils/onChainOddsSync");
const { buildActiveMarketFilter } = require("./utils/marketState");
const Poll = require("./models/Poll");
const LadderGroup = require("./models/LadderGroup");

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = (process.env.CLIENT_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const io = socketIo(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length === 1 ? ALLOWED_ORIGINS[0] : ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
});

const onChainTradeReconciler = createOnChainTradeReconciler({ io });
const onChainTransactionIndexer = createOnChainTransactionIndexer({ io });

// Ladder group syncer — periodically advances "active"/"resolving" groups to "resolved"
// and recomputes rung Poll outcomes from on-chain state.
let _ladderGroupSyncTimer = null;
function startLadderGroupSyncer() {
  const INTERVAL_MS = Number(process.env.LADDER_GROUP_SYNC_INTERVAL_MS) || 60_000;
  _ladderGroupSyncTimer = setInterval(async () => {
    try {
      const groups = await LadderGroup.find({ status: { $in: ["active", "resolving"] } }).select("groupId");
      if (!groups.length) return;
      for (const group of groups) {
        await syncLadderGroup(group.groupId, { logger: console }).catch((err) => {
          console.error(`[ladder-group-sync] error for groupId=${group.groupId}:`, err?.message || err);
        });
      }
    } catch (err) {
      console.error("[ladder-group-sync] tick error:", err?.message || err);
    }
  }, INTERVAL_MS);
  console.log(`[ladder-group-sync] started (interval=${INTERVAL_MS}ms)`);
}
function stopLadderGroupSyncer() {
  if (_ladderGroupSyncTimer) {
    clearInterval(_ladderGroupSyncTimer);
    _ladderGroupSyncTimer = null;
    console.log("[ladder-group-sync] stopped");
  }
}


// justo después de crear app()
app.set("trust proxy", 1);

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: ALLOWED_ORIGINS.length === 1 ? ALLOWED_ORIGINS[0] : ALLOWED_ORIGINS,
    credentials: true,
  })
);

// Rate limiting (skip high-frequency public GETs that are cached)
const RATE_LIMIT_WINDOW_MS =
  Number(process.env.RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX =
  Number(process.env.RATE_LIMIT_MAX) || 2500; // limit each IP to N requests per window
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.method === "GET" && req.path.startsWith("/api/polls/trending"),
});
app.use(limiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Database connection
mongoose
  .connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/stacksmarket",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 20,
    }
  )
  .then(() => {
    console.log("Connected to MongoDB");
    const reconcilerEnabled =
      (process.env.TRADE_RECONCILER_ENABLED || "true").toLowerCase() !== "false";
    if (reconcilerEnabled) onChainTradeReconciler.start();
    const indexerEnabled =
      (process.env.ONCHAIN_INDEXER_ENABLED || "true").toLowerCase() !== "false";
    if (indexerEnabled) onChainTransactionIndexer.start();
    const ladderSyncEnabled =
      (process.env.LADDER_GROUP_SYNC_ENABLED || "true").toLowerCase() !== "false";
    if (ladderSyncEnabled) startLadderGroupSyncer();

    // Sync all active market odds AND repair historical trade prices on startup
    (async () => {
      try {
        await syncAllActiveMarkets({ logger: console });
        const polls = await Poll.find({
          $and: [buildActiveMarketFilter(), { marketId: { $exists: true, $ne: "" } }],
        }).select("_id");
        const REPAIR_CONCURRENCY = 5;
        for (let i = 0; i < polls.length; i += REPAIR_CONCURRENCY) {
          await Promise.allSettled(
            polls.slice(i, i + REPAIR_CONCURRENCY).map((p) => repairTradePricesForPoll(p._id, null, console))
          );
        }
        console.log("[startup-sync] trade price repair complete");
      } catch (err) {
        console.error("[startup-sync] failed:", err?.message || err);
      }
    })();
  })
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/polls", require("./routes/polls"));
app.use("/api/users", require("./routes/users"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/trades", require("./routes/trades"));
app.use("/api/comments", require("./routes/comments"));
app.use("/api/stacks", require("./routes/stacks"));
app.use("/api/market", require("./routes/market"));
app.use("/api/uploads", require("./routes/uploads"));
app.use("/api/ladder", require("./routes/ladder"));

// Socket.io for real-time updates
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-poll", (pollId) => {
    socket.join(`poll-${pollId}`);
  });

  socket.on("leave-poll", (pollId) => {
    socket.leave(`poll-${pollId}`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Make io available to routes
app.set("io", io);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

app.get("/health", (_req, res) => res.status(200).send("ok"));


// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on("SIGINT", () => {
  onChainTradeReconciler.stop();
  onChainTransactionIndexer.stop();
  stopLadderGroupSyncer();
});
process.on("SIGTERM", () => {
  onChainTradeReconciler.stop();
  onChainTransactionIndexer.stop();
  stopLadderGroupSyncer();
});
