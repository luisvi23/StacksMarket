const express = require("express");
const axios = require("axios");
const router = express.Router();

function getHiroConfig() {
  const network = (process.env.STACKS_NETWORK || "mainnet").toLowerCase();
  const hiroBase =
    network === "testnet" ? "https://api.testnet.hiro.so" : "https://api.mainnet.hiro.so";
  const hiroApiKey = process.env.HIRO_API_KEY;
  return { network, hiroBase, hiroApiKey };
}

// Proxy endpoint for Hiro Stacks API transaction status
// GET /api/stacks/tx/:txId
router.get("/tx/:txId", async (req, res) => {
  const rawTxId = req.params.txId || "";
  const txId = rawTxId.startsWith("0x") ? rawTxId : `0x${rawTxId}`;
  try {
    const { hiroBase, hiroApiKey } = getHiroConfig();
    const hiroUrl = `${hiroBase}/extended/v1/tx/${txId}`;
    const response = await axios.get(hiroUrl, {
      headers: hiroApiKey ? { "x-api-key": hiroApiKey } : undefined,
    });
    res.status(200).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      message: "Failed to fetch transaction status from Hiro API",
      error: err.message,
    });
  }
});

// Proxy endpoint for Hiro read-only contract calls to avoid browser CORS
// POST /api/stacks/call-read
router.post("/call-read", async (req, res) => {
  const {
    contractAddress,
    contractName,
    functionName,
    functionArgs,
    senderAddress,
  } = req.body;
  try {
    const { hiroBase, hiroApiKey } = getHiroConfig();
    const hiroUrl = `${hiroBase}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`;
    const payload = { sender: senderAddress, arguments: functionArgs };
    const response = await axios.post(hiroUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        ...(hiroApiKey ? { "x-api-key": hiroApiKey } : {}),
      },
    });
    res.status(200).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      message: "Failed to call-read via Hiro API",
      error: err.message,
      details: err.response?.data,
    });
  }
});

// Proxy endpoint for current Stacks tip height + server UTC time
// GET /api/stacks/chain-tip
router.get("/chain-tip", async (_req, res) => {
  try {
    const { network, hiroBase, hiroApiKey } = getHiroConfig();
    const response = await axios.get(`${hiroBase}/v2/info`, {
      headers: hiroApiKey ? { "x-api-key": hiroApiKey } : undefined,
    });

    const data = response.data || {};
    const stacksTipHeight =
      Number(data.stacks_tip_height ?? data.stacks_tip ?? data.tip_height ?? data.stacks_tip_height);
    const burnBlockHeight = Number(data.burn_block_height);

    if (!Number.isFinite(stacksTipHeight)) {
      return res.status(502).json({
        message: "Hiro /v2/info response missing stacks tip height",
        details: data,
      });
    }
    if (!Number.isFinite(burnBlockHeight)) {
      return res.status(502).json({
        message: "Hiro /v2/info response missing burn block height",
        details: data,
      });
    }

    return res.status(200).json({
      network,
      serverTimeMs: Date.now(),
      serverTimeIso: new Date().toISOString(),
      stacksTipHeight: Math.floor(stacksTipHeight),
      burnBlockHeight: Math.floor(burnBlockHeight),
      // Contract currently uses Clarity `block-height`, which maps to burn chain height here.
      contractBlockHeight: Math.floor(burnBlockHeight),
      hiro: data,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    return res.status(status).json({
      message: "Failed to fetch Stacks chain tip from Hiro API",
      error: err.message,
      details: err.response?.data,
    });
  }
});

// Proxy endpoint for STX account balance
// GET /api/stacks/account/:address
router.get("/account/:address", async (req, res) => {
  const address = req.params.address;
  if (!address) return res.status(400).json({ message: "Address is required" });
  try {
    const { hiroBase, hiroApiKey } = getHiroConfig();
    const hiroUrl = `${hiroBase}/v2/accounts/${address}?proof=0`;
    const response = await axios.get(hiroUrl, {
      headers: hiroApiKey ? { "x-api-key": hiroApiKey } : undefined,
    });
    res.status(200).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ message: "Failed to fetch account balance", error: err.message });
  }
});

module.exports = router;
