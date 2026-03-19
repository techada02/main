/**
 * KaamMitra – Hybrid Labour Marketplace Platform
 * Main Express Server
 *
 * Features:
 * - OTP-based authentication (workers & customers)
 * - Location-based job dispatch
 * - Worker ranking system (Bronze → Platinum)
 * - Keypad phone support via SMS + missed call confirmation
 * - Urgent job prioritisation
 * - Job lifecycle: post → dispatch → accept → start → complete → rate
 */
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const rateLimit    = require('express-rate-limit');
const { setupDatabase } = require('./db/setup');

const authRoutes    = require('./routes/auth');
const workerRoutes  = require('./routes/workers');
const jobRoutes     = require('./routes/jobs');
const smsRoutes     = require('./routes/sms');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Twilio webhook sends form data

// Rate limiting – prevent brute force
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests. Please try again later.' },
}));

app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 100,
}));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── API Routes ──────────────────────────────────────────────────────────────

app.use('/api/auth',    authRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/jobs',    jobRoutes);
app.use('/api/sms',     smsRoutes);

// ─── Health Check ────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'KaamMitra Labour Marketplace API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Pricing Suggestion (market-based) ──────────────────────────────────────

app.get('/api/pricing/:category', async (req, res) => {
  try {
    const { getDb, getAll } = require('./db/setup');
    const db   = getDb();
    const rows = await getAll(db,
      'SELECT daily_rate FROM workers WHERE category=? AND is_available=1',
      [req.params.category]);
    db.close();

    if (rows.length === 0) {
      return res.json({ success: true, category: req.params.category, message: 'No pricing data yet', suggested_min: null, suggested_max: null });
    }

    const rates = rows.map(r => r.daily_rate).sort((a, b) => a - b);
    const mid   = Math.floor(rates.length / 2);
    const median = rates.length % 2 !== 0 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
    const avg   = rates.reduce((s, r) => s + r, 0) / rates.length;

    res.json({
      success: true,
      category: req.params.category,
      worker_count:  rows.length,
      suggested_min: Math.round(rates[0]),
      suggested_max: Math.round(rates[rates.length - 1]),
      median_rate:   Math.round(median),
      average_rate:  Math.round(avg),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get pricing data' });
  }
});

// ─── Categories List ─────────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => {
  res.json({
    success: true,
    categories: [
      'Mason', 'Plumber', 'Electrician', 'Carpenter', 'Painter',
      'Welder', 'AC Technician', 'House Help', 'Construction Labour',
      'Loading/Unloading', 'Driver', 'Security Guard', 'Gardener',
      'Tiler', 'Cleaner', 'Cook', 'general',
    ],
  });
});

// ─── Catch-all – serve frontend SPA ─────────────────────────────────────────

app.get('*', rateLimit({ windowMs: 60 * 1000, max: 200 }), (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    await setupDatabase();
    app.listen(PORT, () => {
      console.log(`\n🚀 KaamMitra API running on http://localhost:${PORT}`);
      console.log(`📦 Frontend served from: http://localhost:${PORT}`);
      console.log(`💡 Health check: http://localhost:${PORT}/api/health\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

boot();

module.exports = app; // For testing
