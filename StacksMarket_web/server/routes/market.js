const express = require('express');
const MarketConfig = require('../models/MarketConfig');
const { adminAuth } = require('../middleware/auth');

const router = express.Router();

// GET public market status
router.get('/status', async (req, res) => {
  try {
    let cfg = await MarketConfig.findOne();
    if (!cfg) {
      cfg = await MarketConfig.create({});
    }
    res.json({ paused: !!cfg.paused, lastTx: cfg.lastTx });
  } catch (err) {
    console.error('Get market status error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ADMIN: set market pause state
router.post('/admin/pause', adminAuth, async (req, res) => {
  try {
    const { paused, txid } = req.body;
    let cfg = await MarketConfig.findOne();
    if (!cfg) cfg = await MarketConfig.create({});
    cfg.paused = !!paused;
    if (txid) cfg.lastTx = txid;
    await cfg.save();

    // Emit socket update
    const io = req.app.get('io');
    if (io) io.emit('market-status-updated', { paused: cfg.paused });

    res.json({ message: 'Market status updated', paused: cfg.paused, lastTx: cfg.lastTx });
  } catch (err) {
    console.error('Set market pause error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
