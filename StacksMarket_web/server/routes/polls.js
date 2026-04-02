// routes/polls.js
const express = require("express");
const axios = require("axios");
const Poll = require("../models/Poll");
const Trade = require("../models/Trade");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { auth, optionalAuth } = require("../middleware/auth");
const { buildMarketStateFilter, buildActiveMarketFilter } = require("../utils/marketState");

const router = express.Router();

const TRENDING_CACHE_TTL_MS = Number(process.env.TRENDING_CACHE_TTL_MS) || 15000;
const trendingCache = new Map();
const trendingInflight = new Map();

function getCache(key) {
  const entry = trendingCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    trendingCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  trendingCache.set(key, {
    data,
    expiresAt: Date.now() + TRENDING_CACHE_TTL_MS,
  });
}

function getHiroBase() {
  const network = (process.env.STACKS_NETWORK || "mainnet").toLowerCase();
  return network === "testnet" ? "https://api.testnet.hiro.so" : "https://api.mainnet.hiro.so";
}

/**
 * ------------------------------------------------------------
 * Helpers: percentages (SIN writes)
 * ------------------------------------------------------------
 * Evita hacer poll.save() en endpoints de lectura (GET /, /trending, /:id)
 * pero mantiene la misma lógica de prioridad:
 * 1) impliedProbability (>0) -> normaliza y copia a percentage
 * 2) percentage (>0) -> normaliza
 * 3) fallback a volumen
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function syncPercentagesInMemory(pollLike) {
  if (!pollLike || !Array.isArray(pollLike.options)) return pollLike;
  const opts = pollLike.options;
  const n = opts.length;
  if (!n) return pollLike;

  const hasImplied = opts.some(
    (o) =>
      typeof o?.impliedProbability === "number" &&
      Number.isFinite(o.impliedProbability) &&
      o.impliedProbability > 0
  );

  if (hasImplied) {
    const raw = opts.map((o) =>
      Number.isFinite(o?.impliedProbability) ? o.impliedProbability : 0
    );
    const sum = raw.reduce((acc, v) => acc + v, 0);

    if (!Number.isFinite(sum) || sum <= 0) {
      const equal = 100 / n;
      opts.forEach((o) => {
        o.percentage = equal;
      });
    } else {
      opts.forEach((o, i) => {
        const pct = (raw[i] / sum) * 100;
        o.percentage = clamp(pct, 0, 100);
      });
    }
    return pollLike;
  }

  const hasPct = opts.some(
    (o) =>
      typeof o?.percentage === "number" &&
      Number.isFinite(o.percentage) &&
      o.percentage > 0
  );

  if (hasPct) {
    const raw = opts.map((o) =>
      Number.isFinite(o?.percentage) ? o.percentage : 0
    );
    const sum = raw.reduce((acc, v) => acc + v, 0);

    if (!Number.isFinite(sum) || sum <= 0) {
      const equal = 100 / n;
      opts.forEach((o) => {
        o.percentage = equal;
      });
    } else {
      opts.forEach((o, i) => {
        const pct = (raw[i] / sum) * 100;
        o.percentage = clamp(pct, 0, 100);
      });
    }
    return pollLike;
  }

  // fallback volumen
  const vols = opts.map((o) => Number(o?.totalVolume) || 0);
  const sumVol = vols.reduce((acc, v) => acc + v, 0);

  if (sumVol > 0) {
    opts.forEach((o, i) => {
      const pct = (vols[i] / sumVol) * 100;
      o.percentage = clamp(pct, 0, 100);
    });
  } else {
    const equal = 100 / n;
    opts.forEach((o) => {
      o.percentage = equal;
    });
  }

  return pollLike;
}

//  helper: parse % (acepta 0)
function parsePct(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

/**
 *  helper: seed odds binarios robusto
 * - acepta initialYesPct/initialNoPct o yesPct/noPct
 * - permite que venga solo uno (el otro = 100 - ese)
 * - normaliza por suma
 * - si no hay datos -> 50/50
 */
function computeBinarySeedOdds(body) {
  let y = parsePct(body.initialYesPct ?? body.yesPct);
  let n = parsePct(body.initialNoPct ?? body.noPct);

  // permitir que te manden solo uno
  if (y == null && n != null) y = 100 - n;
  if (n == null && y != null) n = 100 - y;

  // si sigue faltando o ambos 0 -> default 50/50
  if (y == null || n == null || (y === 0 && n === 0)) {
    return { y: 50, n: 50, used: false };
  }

  const sum = y + n;
  if (!Number.isFinite(sum) || sum <= 0) return { y: 50, n: 50, used: false };

  const yNorm = (y / sum) * 100;
  const nNorm = 100 - yNorm; // asegura 100 exacto
  return { y: yNorm, n: nNorm, used: true };
}

function buildPollDataFromBody(req) {
  const {
    title,
    description,
    category,
    subCategory,
    options,
    endDate,
    rules,
    tags,
    image,
    team1,
    team2,
    matchTime,
    sportType,
    cryptoName,
    cryptoLogo,
    country,
    countryFlag,
    candidates,
    location,
    marketId,

    // odds iniciales binarios (sí, vienen en el body pero las lee el helper)
    initialYesPct,
    initialNoPct,
    yesPct,
    noPct,
  } = req.body;

  const descriptionStr =
    typeof description === "string" ? description.trim() : "";
  const safeDescription = descriptionStr || "No description";

  // Validate required fields
  if (!title || !category || !subCategory || !options || !endDate) {
    return { error: "Missing required fields" };
  }

  // Validate options
  if (!Array.isArray(options) || options.length < 2) {
    return { error: "At least 2 options are required" };
  }

  // Validate end date
  // Admin UI uses `datetime-local` (no timezone). We treat that input as UTC by convention
  // so scheduling is anchored to server/UTC, not the browser's local timezone.
  const endDateRaw = String(endDate || "").trim();
  const endDateUtcLike = /z$|[+\-]\d{2}:\d{2}$/i.test(endDateRaw)
    ? endDateRaw
    : `${endDateRaw}Z`;
  const endDateObj = new Date(endDateUtcLike);
  if (Number.isNaN(endDateObj.getTime())) {
    return { error: "Invalid end date" };
  }
  if (endDateObj <= new Date()) {
    return { error: "End date must be in the future" };
  }

  const isBinary = options.length === 2;
  const seed = isBinary ? computeBinarySeedOdds(req.body) : null;

  const pollData = {
    title,
    description: safeDescription,
    category,
    subCategory,
    options: options.map((opt, idx) => {
      const base = {
        text: opt.text,
        image: opt.image || "",
      };

      // BINARIO: SIEMPRE seed (si no viene, será 50/50 igualmente)
      if (isBinary) {
        const pct = idx === 0 ? seed.y : seed.n;
        return {
          ...base,
          percentage: pct, // float 0-100
          impliedProbability: Math.round(pct), // int 0-100 (para UI rápida)
          totalVolume: 0,
          totalTrades: 0,
        };
      }

      // impliedProbability explícito por option
      const imp = opt?.impliedProbability;
      if (imp !== undefined && imp !== null) {
        const n = parsePct(imp);
        if (n != null) {
          return {
            ...base,
            impliedProbability: Math.round(clamp(n, 0, 100)),
            percentage: 0, // lo sincronizamos luego usando implied
            totalVolume: 0,
            totalTrades: 0,
          };
        }
      }

      // percentage explícito por option
      const pct = opt?.percentage;
      if (pct !== undefined && pct !== null) {
        const n = parsePct(pct);
        if (n != null) {
          return {
            ...base,
            percentage: clamp(n, 0, 100),
            impliedProbability: 0,
            totalVolume: 0,
            totalTrades: 0,
          };
        }
      }

      // fallback equal
      return {
        ...base,
        percentage: 100 / options.length,
        impliedProbability: 0,
        totalVolume: 0,
        totalTrades: 0,
      };
    }),
    endDate: endDateObj,
    rules: rules || "Standard prediction market rules apply.",
    tags: tags || [],
    image: image || "",
    createdBy: req.user._id,
    marketId: marketId || null,
  };

  // Add category-specific data
  if (category === "Sports" && team1 && team2) {
    pollData.team1 = team1;
    pollData.team2 = team2;
    pollData.matchTime = matchTime;
    pollData.sportType = sportType;
  }

  if (category === "Crypto" && cryptoName) {
    pollData.cryptoName = cryptoName;
    pollData.cryptoLogo = cryptoLogo;
  }

  if (category === "Elections" && country) {
    pollData.country = country;
    pollData.countryFlag = countryFlag;
    pollData.candidates = candidates || [];
  }

  if (location) {
    pollData.location = location;
  }

  return { pollData, isBinary, seed };
}

/**
 * ------------------------------------------------------------
 * @route POST /api/polls/pending
 * @desc  Create a pending poll before on-chain tx
 * @access Private
 * ------------------------------------------------------------
 */
router.post("/pending", auth, async (req, res) => {
  try {
    if (!req.body.marketId) {
      return res.status(400).json({ message: "marketId required" });
    }

    const existing = await Poll.findOne({ marketId: req.body.marketId });
    if (existing) {
      return res.status(409).json({ message: "marketId already exists" });
    }

    const { pollData, isBinary, seed, error } = buildPollDataFromBody(req);
    if (error) {
      return res.status(400).json({ message: error });
    }

    pollData.isActive = false;
    pollData.creationStatus = "pending";
    pollData.createTxId = null;

    const poll = new Poll(pollData);

    if (isBinary && poll.options?.length === 2) {
      poll.options[0].percentage = seed.y;
      poll.options[1].percentage = seed.n;
      poll.options[0].impliedProbability = Math.round(seed.y);
      poll.options[1].impliedProbability = Math.round(seed.n);
      poll.markModified("options");
    }

    syncPercentagesInMemory(poll);

    await poll.save();
    await poll.populate("createdBy", "username avatar");

    res.status(201).json({
      message: "Pending poll created",
      poll,
    });
  } catch (error) {
    console.error("Create pending poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route POST /api/polls/pending/:id/txid
 * @desc  Attach createTxId to a pending poll
 * @access Private
 * ------------------------------------------------------------
 */
router.post("/pending/:id/txid", auth, async (req, res) => {
  try {
    const { txid, marketId } = req.body;

    if (!txid) {
      return res.status(400).json({ message: "txid required" });
    }

    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ message: "Poll not found" });

    if (
      poll.createdBy.toString() !== req.user._id.toString() &&
      !req.user.isAdmin
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (marketId && poll.marketId && String(poll.marketId) !== String(marketId)) {
      return res.status(409).json({ message: "marketId mismatch" });
    }

    if (marketId && !poll.marketId) {
      const exists = await Poll.findOne({
        marketId,
        _id: { $ne: poll._id },
      });
      if (exists) {
        return res.status(409).json({ message: "marketId already exists" });
      }
      poll.marketId = marketId;
    }

    poll.createTxId = txid;
    await poll.save();
    await poll.populate("createdBy", "username avatar");

    res.json({ message: "createTxId saved", poll });
  } catch (error) {
    console.error("Save createTxId error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route POST /api/polls/pending/:id/reconcile
 * @desc  Reconcile a pending poll using createTxId (Hiro tx status)
 * @access Private
 * ------------------------------------------------------------
 */
router.post("/pending/:id/reconcile", auth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ message: "Poll not found" });

    if (
      poll.createdBy.toString() !== req.user._id.toString() &&
      !req.user.isAdmin
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (poll.creationStatus === "confirmed") {
      await poll.populate("createdBy", "username avatar");
      return res.json({ message: "Poll already confirmed", poll });
    }

    if (!poll.createTxId) {
      return res.status(400).json({ message: "createTxId missing" });
    }

    const rawTx = poll.createTxId;
    const txId = rawTx.startsWith("0x") ? rawTx : `0x${rawTx}`;
    const hiroUrl = `${getHiroBase()}/extended/v1/tx/${txId}`;

    let hiroRes;
    try {
      const hiroApiKey = process.env.HIRO_API_KEY;
      hiroRes = await axios.get(hiroUrl, {
        headers: hiroApiKey ? { "x-api-key": hiroApiKey } : undefined,
      });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        return res.json({ message: "Tx not indexed yet", status: "pending" });
      }
      return res.status(status || 500).json({
        message: "Failed to fetch transaction status from Hiro API",
        error: err.message,
      });
    }

    const status = hiroRes.data?.tx_status;
    if (status === "success") {
      poll.creationStatus = "confirmed";
      poll.isActive = true;
      await poll.save();
      await poll.populate("createdBy", "username avatar");
      return res.json({ message: "Poll confirmed", poll });
    }

    if (
      status === "abort_by_response" ||
      status === "abort_by_post_condition" ||
      status === "failed"
    ) {
      return res.status(409).json({
        message: "Transaction failed",
        status,
        tx: hiroRes.data,
      });
    }

    return res.json({ message: "Tx pending", status: "pending" });
  } catch (error) {
    console.error("Reconcile poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route POST /api/polls/confirm
 * @desc  Confirm a pending poll after on-chain tx
 * @access Private
 * ------------------------------------------------------------
 */
router.post("/confirm", auth, async (req, res) => {
  try {
    const { pendingPollId, txid, marketId } = req.body;

    if (!pendingPollId) {
      return res.status(400).json({ message: "pendingPollId required" });
    }

    const poll = await Poll.findById(pendingPollId);
    if (!poll) {
      return res.status(404).json({ message: "Pending poll not found" });
    }

    if (poll.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (poll.creationStatus === "confirmed") {
      await poll.populate("createdBy", "username avatar");
      return res.json({ message: "Poll already confirmed", poll });
    }

    if (marketId && poll.marketId && String(poll.marketId) !== String(marketId)) {
      return res.status(409).json({ message: "marketId mismatch" });
    }

    if (marketId && !poll.marketId) {
      const exists = await Poll.findOne({
        marketId,
        _id: { $ne: poll._id },
      });
      if (exists) {
        return res.status(409).json({ message: "marketId already exists" });
      }
      poll.marketId = marketId;
    }

    poll.createTxId = txid || poll.createTxId || null;
    poll.creationStatus = "confirmed";
    poll.isActive = true;

    await poll.save();
    await poll.populate("createdBy", "username avatar");

    res.json({
      message: "Poll confirmed",
      poll,
    });
  } catch (error) {
    console.error("Confirm poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route GET /api/polls
 * @desc  Get all polls with filtering
 * @access Public
 * ------------------------------------------------------------
 */
router.get("/", optionalAuth, async (req, res) => {
  try {
    const {
      category,
      subCategory,
      search,
      sort = "createdAt",
      order = "desc",
      page = 1,
      limit = 20,
      trending,
      featured,
      timeframe, // 'hour' | 'day' | 'month'
      cryptoName,
      marketState = "listed",
    } = req.query;

    // Base filter by lifecycle: listed (default) | active | closed
    const and = [buildMarketStateFilter(marketState)];

    if (category && category !== "All") and.push({ category });
    if (subCategory && subCategory !== "All") and.push({ subCategory });

    if (search) {
      and.push({
        $or: [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { tags: { $in: [new RegExp(search, "i")] } },
        ],
      });
    }

    if (trending === "true") and.push({ trending: true });
    if (featured === "true") and.push({ featured: true });
    if (cryptoName) and.push({ cryptoName });

    // Timeframe filter (by createdAt)
    if (timeframe) {
      const now = new Date();
      let from;

      if (timeframe === "hour" || timeframe === "hourly") {
        from = new Date(now.getTime() - 60 * 60 * 1000);
      } else if (timeframe === "day" || timeframe === "daily") {
        from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (timeframe === "month" || timeframe === "monthly") {
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      if (from) and.push({ createdAt: { $gte: from } });
    }

    const query = and.length === 1 ? and[0] : { $and: and };

    // Sort options
    const sortOptions = {};
    switch (sort) {
      case "volume":
        sortOptions.totalVolume = order === "desc" ? -1 : 1;
        break;
      case "trades":
        sortOptions.totalTrades = order === "desc" ? -1 : 1;
        break;
      case "endDate":
        sortOptions.endDate = order === "desc" ? -1 : 1;
        break;
      default:
        sortOptions.createdAt = order === "desc" ? -1 : 1;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const polls = await Poll.find(query)
      .populate("createdBy", "username avatar")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Poll.countDocuments(query);

    //  Sync percentages solo para respuesta (sin writes)
    let synced = polls.map((p) => syncPercentagesInMemory(p));

    // Inject isSaved for authenticated users
    if (req.user) {
      const userDoc = await User.findById(req.user._id).select("savedPolls").lean();
      const savedSet = new Set((userDoc?.savedPolls || []).map((id) => String(id)));
      synced = synced.map((p) => {
        const obj = p.toObject ? p.toObject() : { ...p };
        obj.isSaved = savedSet.has(String(p._id));
        return obj;
      });
    }

    res.json({
      polls: synced,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: skip + polls.length < total,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Get polls error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route GET /api/polls/trending
 * @desc  Get trending polls
 * @access Public
 * ------------------------------------------------------------
 */
router.get("/trending", optionalAuth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const lim = Math.max(1, Math.min(100, parseInt(limit)));
    const cacheKey = `trending:${lim}`;

    const cached = getCache(cacheKey);
    if (cached) {
      res.set("Cache-Control", `public, max-age=${Math.floor(TRENDING_CACHE_TTL_MS / 1000)}, s-maxage=${Math.floor(TRENDING_CACHE_TTL_MS / 1000)}`);
      return res.json(cached);
    }

    if (trendingInflight.has(cacheKey)) {
      const data = await trendingInflight.get(cacheKey);
      res.set("Cache-Control", `public, max-age=${Math.floor(TRENDING_CACHE_TTL_MS / 1000)}, s-maxage=${Math.floor(TRENDING_CACHE_TTL_MS / 1000)}`);
      return res.json(data);
    }

    const work = (async () => {
      const polls = await Poll.find({
        $and: [buildActiveMarketFilter(), { trending: true }],
      })
        .populate("createdBy", "username avatar")
        .sort({ createdAt: -1 })
        .limit(lim);

      const synced = polls.map((p) => syncPercentagesInMemory(p));
      setCache(cacheKey, synced);
      return synced;
    })();

    trendingInflight.set(cacheKey, work);
    let data;
    try {
      data = await work;
    } finally {
      trendingInflight.delete(cacheKey);
    }

    res.set("Cache-Control", `public, max-age=${Math.floor(TRENDING_CACHE_TTL_MS / 1000)}, s-maxage=${Math.floor(TRENDING_CACHE_TTL_MS / 1000)}`);
    res.json(data);
  } catch (error) {
    console.error("Get trending polls error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route GET /api/polls/categories
 * @desc  Get available categories and sub-categories
 * @access Public
 * ------------------------------------------------------------
 */
router.get("/categories", async (req, res) => {
  try {
    const categories = {
      Politics: [
        "All",
        "Trump-Putin",
        "Trump Presidency",
        "Trade War",
        "Israel Ukraine",
        "Inflation",
        "AI Geopolitics GPT-5",
        "Texas",
        "Redistricting",
        "Epstein",
        "Jerome Powell",
        "Earn 4%",
        "Fed Rates",
      ],
      "Middle East": [
        "All",
        "Israel Gaza",
        "India-Pakistan",
        "Iran Military Actions",
        "Khamenei",
        "Syria",
        "Yemen",
        "Lebanon",
        "Turkey",
      ],
      Crypto: [
        "All",
        "Stacks",
        "Ethereum",
        "Binance",
        "Cardano",
        "Solana",
        "Polkadot",
        "Chainlink",
        "Uniswap",
        "DeFi",
        "NFTs",
      ],
      Tech: [
        "All",
        "AI",
        "GPT-5",
        "Elon Musk",
        "Grok",
        "Science",
        "SpaceX",
        "OpenAI",
        "MicroStrategy",
        "Big Tech",
        "TikTok",
        "Meta",
      ],
      Culture: [
        "All",
        "Tweet Markets",
        "Astronomer",
        "Movies",
        "Courts",
        "Weather",
        "GTA VI",
        "Kanye",
        "Global Temp",
        "Mentions",
        "Celebrities",
        "New Pope",
        "Elon Musk",
        "Music",
        "Pandemics",
        "Awards",
      ],
      World: [
        "All",
        "Bolivia",
        "Ukraine",
        "Iran",
        "Middle East",
        "Global Elections",
        "India-Pakistan",
        "Gaza",
        "Israel",
        "China",
        "Geopolitics",
      ],
      Economy: [
        "All",
        "Trade War",
        "Fed Rates",
        "Inflation",
        "Taxes",
        "Macro Indicators",
        "Treasuries",
      ],
      Sports: [
        "All",
        "Football",
        "Basketball",
        "Baseball",
        "Soccer",
        "Tennis",
        "Golf",
        "Boxing",
        "MMA",
        "Olympics",
      ],
      Elections: [
        "All",
        "US Presidential",
        "US Senate",
        "US House",
        "State Elections",
        "International Elections",
      ],
      Mentions: ["All", "Twitter", "Reddit", "YouTube", "TikTok", "Instagram"],
    };

    res.json(categories);
  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

//  IMPORTANTE: esta ruta tiene que ir ANTES de "/:id"
router.get("/user/saved", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "savedPolls",
      match: { isActive: true },
      populate: { path: "createdBy", select: "username avatar" },
    });

    // sync en memoria para UI + mark as saved
    const saved = (user?.savedPolls || []).map((p) => {
      const obj = syncPercentagesInMemory(p);
      const plain = obj.toObject ? obj.toObject() : { ...obj };
      plain.isSaved = true;
      return plain;
    });
    res.json(saved);
  } catch (error) {
    console.error("Get saved polls error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route GET /api/polls/:id/holders
 * @desc  Top holders (net shares per user per option)
 * @access Public
 * ------------------------------------------------------------
 */
router.get("/:id/holders", async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id).select("_id options").lean();
    if (!poll) return res.status(404).json({ message: "Poll not found" });

    const holders = await Trade.aggregate([
      { $match: { poll: poll._id, status: "completed" } },
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

    res.json({ holders, options: poll.options });
  } catch (error) {
    console.error("Get top holders error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route GET /api/polls/:id
 * @desc  Get single poll by ID
 * @access Public
 * ------------------------------------------------------------
 */
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id).populate(
      "createdBy",
      "username avatar"
    );

    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    //  Sync percentages (sin writes)
    syncPercentagesInMemory(poll);

    // Get order book if user is authenticated
    let orderBook = null;
    if (req.user) {
      orderBook = await Trade.getOrderBook(poll._id, 0);
    }

    // Include completed trades plus indexed on-chain transactions (also from external wallets/apps).
    const dbTradesRaw = await Trade.find({ poll: poll._id, status: "completed" })
      .populate("user", "username avatar")
      .sort({ createdAt: -1 })
      .limit(50);
    const dbTrades = dbTradesRaw.map((tradeDoc) => {
      const t = tradeDoc?.toObject ? tradeDoc.toObject() : tradeDoc;
      // Historical on-chain indexed trades may carry inferred prices that are not reliable.
      if (t?.notes === "indexed-from-onchain") {
        t.price = null;
      }
      return t;
    });
    const indexedTx = await Transaction.find({
      poll: poll._id,
      kind: { $in: ["buy", "sell"] },
      status: "success",
    })
      .populate("user", "username avatar walletAddress")
      .sort({ createdAt: -1 })
      .limit(100);

    const syntheticTrades = indexedTx.map((tx) => ({
      _id: tx._id,
      type: tx.kind,
      optionIndex: Number.isFinite(Number(tx.optionIndex)) ? Number(tx.optionIndex) : 0,
      amount: Number.isFinite(Number(tx.amount)) ? Number(tx.amount) : 0,
      // For externally indexed txs (e.g., Hiro Explorer) we cannot reliably infer execution probability
      // from tx args (auto-buys pass max-cost, not exact execution price), so keep it unknown.
      price: null,
      totalValue: Number.isFinite(Number(tx.totalValue)) ? Number(tx.totalValue) : 0,
      transactionHash: tx.txid,
      createdAt: tx.blockTime || tx.createdAt,
      user:
        tx.user || tx.walletAddress
          ? {
              _id: tx.user?._id || null,
              username: tx.user?.username || (tx.walletAddress || "wallet").slice(0, 10),
              avatar: tx.user?.avatar || "",
            }
          : null,
    }));

    const seen = new Set();
    const tradeHistory = [];

    for (const t of dbTrades) {
      const key = String(t.transactionHash || t._id);
      if (seen.has(key)) continue;
      seen.add(key);
      tradeHistory.push(t);
    }

    for (const t of syntheticTrades) {
      const key = String(t.transactionHash || t._id);
      if (seen.has(key)) continue;
      seen.add(key);
      tradeHistory.push(t);
    }

    tradeHistory.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Inject isSaved for authenticated users
    let pollObj = poll.toObject ? poll.toObject() : poll;
    if (req.user) {
      const userDoc = await User.findById(req.user._id).select("savedPolls").lean();
      const savedSet = new Set((userDoc?.savedPolls || []).map((id) => String(id)));
      pollObj = { ...pollObj, isSaved: savedSet.has(String(poll._id)) };
    }

    res.json({
      poll: pollObj,
      orderBook,
      tradeHistory: tradeHistory.slice(0, 50),
    });
  } catch (error) {
    console.error("Get poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route POST /api/polls
 * @desc  Create a new poll
 * @access Private
 * ------------------------------------------------------------
 */
router.post("/", auth, async (req, res) => {
  try {
    const { pollData, isBinary, seed, error } = buildPollDataFromBody(req);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const poll = new Poll(pollData);

    //  Re-aplica y marca modificado por si el schema/hook pisa defaults en subdocs
    if (isBinary && poll.options?.length === 2) {
      poll.options[0].percentage = seed.y;
      poll.options[1].percentage = seed.n;
      poll.options[0].impliedProbability = Math.round(seed.y);
      poll.options[1].impliedProbability = Math.round(seed.n);
      poll.markModified("options");
    }

    //  normaliza (en memoria) por coherencia
    syncPercentagesInMemory(poll);

    await poll.save();
    await poll.populate("createdBy", "username avatar");

    res.status(201).json({
      message: "Poll created successfully",
      poll,
    });
  } catch (error) {
    console.error("Create poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route PUT /api/polls/:id
 * @desc  Update a poll
 * @access Private (Creator or Admin)
 * ------------------------------------------------------------
 */
router.put("/:id", auth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    // Check if user is creator or admin
    if (
      poll.createdBy.toString() !== req.user._id.toString() &&
      !req.user.isAdmin
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Only allow updates if poll is not resolved
    if (poll.isResolved) {
      return res.status(400).json({ message: "Cannot update a resolved poll" });
    }

    const updatedPoll = await Poll.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("createdBy", "username avatar");

    //  coherencia percentages sin doble-save: sync + save una vez
    syncPercentagesInMemory(updatedPoll);
    await updatedPoll.save();

    res.json({
      message: "Poll updated successfully",
      poll: updatedPoll,
    });
  } catch (error) {
    console.error("Update poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route DELETE /api/polls/:id
 * @desc  Delete a poll
 * @access Private (Creator or Admin)
 * ------------------------------------------------------------
 */
router.delete("/:id", auth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    // Check if user is creator or admin
    if (
      poll.createdBy.toString() !== req.user._id.toString() &&
      !req.user.isAdmin
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Soft delete by setting isActive to false
    poll.isActive = false;
    await poll.save();

    res.json({ message: "Poll deleted successfully" });
  } catch (error) {
    console.error("Delete poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route POST /api/polls/:id/save
 * @desc  Save/unsave a poll
 * @access Private
 * ------------------------------------------------------------
 */
router.post("/:id/save", auth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    const user = await User.findById(req.user._id);
    const savedIndex = user.savedPolls.indexOf(poll._id);

    if (savedIndex > -1) {
      user.savedPolls.splice(savedIndex, 1);
    } else {
      user.savedPolls.push(poll._id);
    }

    await user.save();

    res.json({
      message:
        savedIndex > -1
          ? "Poll removed from saved"
          : "Poll saved successfully",
      saved: savedIndex === -1,
    });
  } catch (error) {
    console.error("Save poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route POST /api/polls/:id/redeem
 * @desc  Mark reward as claimed for a poll (after on-chain redeem)
 * @access Private
 * ------------------------------------------------------------
 */
router.post("/:id/redeem", auth, async (req, res) => {
  try {
    const { txid } = req.body;

    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ message: "Poll not found" });

    if (!poll.marketId) {
      return res.status(400).json({
        message: "Poll does not have an associated marketId",
      });
    }

    poll.rewardClaimed = true;
    poll.lastRedeemTx = txid || null;
    await poll.save();

    res.json({ message: "Reward marked claimed", poll });
  } catch (error) {
    console.error("Redeem poll error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ------------------------------------------------------------
 * @route PATCH /api/polls/:id/odds
 * @desc  Set implied probabilities for a binary poll (YES/NO)
 *        y reflejarlo en percentage (normalizado)
 * @access Public (pon auth si quieres)
 *
 * body: { yesPct, noPct }  (0–100, no hace falta que sumen 100)
 * ------------------------------------------------------------
 */
router.patch("/:id/odds", async (req, res) => {
  try {
    const { yesPct, noPct } = req.body;

    const poll = await Poll.findById(req.params.id);
    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    // sólo mercados binarios
    if (!Array.isArray(poll.options) || poll.options.length !== 2) {
      return res
        .status(400)
        .json({ message: "Only binary polls can update odds" });
    }

    const y0 = Number(yesPct);
    const n0 = Number(noPct);

    if (!Number.isFinite(y0) || !Number.isFinite(n0)) {
      return res.status(400).json({ message: "Invalid odds" });
    }
    if (y0 < 0 || y0 > 100 || n0 < 0 || n0 > 100) {
      return res
        .status(400)
        .json({ message: "Odds must be between 0 and 100" });
    }
    if (y0 === 0 && n0 === 0) {
      return res.status(400).json({ message: "Odds cannot both be 0" });
    }

    // normalizamos por suma para evitar 60/60 etc.
    const sum = y0 + n0;
    const y = (y0 / sum) * 100;
    const n = 100 - y;

    poll.options[0].impliedProbability = Math.round(y);
    poll.options[1].impliedProbability = Math.round(n);

    poll.options[0].percentage = y;
    poll.options[1].percentage = n;

    poll.markModified("options");

    // por si redondeos dejan sumas raras, re-normalizamos (en memoria) usando impliedProbability
    syncPercentagesInMemory(poll);

    await poll.save();

    res.json({
      ok: true,
      pollId: poll._id,
      options: poll.options.map((o) => ({
        text: o.text,
        impliedProbability: o.impliedProbability,
        percentage: o.percentage,
      })),
    });
  } catch (error) {
    console.error("Update odds error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
