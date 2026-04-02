// Report on-chain pool (uSTX) per marketId from DB
// Usage: node scripts/reportMarketPools.js
const axios = require("axios");
const mongoose = require("mongoose");
const Poll = require("../models/Poll");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/stacksmarket";

const STACKS_NETWORK = (process.env.STACKS_NETWORK || "mainnet").toLowerCase();
const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA";
const CONTRACT_NAME =
  process.env.CONTRACT_NAME || "market-factory-v18-bias";

const HIRO_BASE =
  STACKS_NETWORK === "testnet"
    ? "https://api.testnet.hiro.so"
    : "https://api.mainnet.hiro.so";

function uintCVHex(n) {
  const v = BigInt(n);
  if (v < 0n) throw new Error("uint must be >= 0");
  const buf = Buffer.alloc(16);
  let x = v;
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return "0x01" + buf.toString("hex");
}

function parsePoolFromRepr(repr) {
  if (typeof repr !== "string") return null;
  const m = repr.match(/\(pool u([0-9]+)\)/);
  return m ? Number(m[1]) : null;
}

async function callReadMarketSnapshot(marketId) {
  const url = `${HIRO_BASE}/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/get-market-snapshot`;
  const payload = {
    sender: CONTRACT_ADDRESS,
    arguments: [uintCVHex(marketId)],
  };
  const res = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
  });
  return res.data;
}

async function main() {
  await mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const polls = await Poll.find({ marketId: { $ne: null } })
    .select("marketId title isResolved isActive")
    .lean();

  const results = [];
  for (const p of polls) {
    const marketId = p.marketId;
    if (!marketId) continue;
    let poolUstx = null;
    let status = "ok";
    try {
      const r = await callReadMarketSnapshot(marketId);
      const repr = r?.result?.repr || r?.result || "";
      poolUstx = parsePoolFromRepr(repr);
      if (poolUstx == null) status = "parse_error";
    } catch (err) {
      status = err?.response?.status
        ? `http_${err.response.status}`
        : "error";
    }

    results.push({
      marketId,
      title: p.title,
      isActive: p.isActive,
      isResolved: p.isResolved,
      poolUstx,
      poolStx: poolUstx != null ? poolUstx / 1_000_000 : null,
      status,
    });
  }

  results.sort((a, b) => (b.poolUstx || 0) - (a.poolUstx || 0));

  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
