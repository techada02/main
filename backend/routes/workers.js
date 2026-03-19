/**
 * Worker Routes
 * - GET    /workers/profile          → Get own worker profile
 * - PUT    /workers/profile          → Update profile / location
 * - PUT    /workers/availability     → Toggle online/offline
 * - GET    /workers/jobs             → View dispatched jobs
 * - GET    /workers/stats            → Earnings & stats
 * - GET    /workers                  → List workers (customer-facing, with filters)
 */
const express = require('express');
const router  = express.Router();

const { getDb, runQuery, getRow, getAll } = require('../db/setup');
const { authMiddleware } = require('../middleware/auth');
const { haversineKm }   = require('../utils/geo');

// GET /workers - List available workers (public, filtered by category & location)
router.get('/', async (req, res) => {
  try {
    const { category, lat, lng, radius = 5 } = req.query;
    const db = getDb();

    let sql = `
      SELECT u.id, u.name, u.phone, w.category, w.daily_rate, w.rank_level,
             w.points, w.total_jobs, w.completion_rate, w.is_available,
             w.lat, w.lng, w.bio, w.aadhaar_verified,
             COALESCE(AVG(r.score), 0) AS avg_rating,
             COUNT(r.id) AS rating_count
      FROM workers w
      JOIN users u ON u.id = w.user_id
      LEFT JOIN ratings r ON r.rated_id = u.id
      WHERE u.is_verified = 1 AND w.is_available = 1
    `;
    const params = [];

    if (category) { sql += ' AND w.category = ?'; params.push(category); }

    sql += ' GROUP BY w.user_id ORDER BY w.points DESC, avg_rating DESC';

    const workers = await getAll(db, sql, params);
    db.close();

    // Filter by distance if location provided
    let filtered = workers;
    if (lat && lng) {
      const customerLat = parseFloat(lat);
      const customerLng = parseFloat(lng);
      const maxRadius   = parseFloat(radius);
      filtered = workers
        .filter(w => w.lat && w.lng)
        .map(w => ({
          ...w,
          distance_km: Math.round(haversineKm(customerLat, customerLng, w.lat, w.lng) * 10) / 10,
        }))
        .filter(w => w.distance_km <= maxRadius)
        .sort((a, b) => a.distance_km - b.distance_km);
    }

    res.json({ success: true, workers: filtered });
  } catch (err) {
    console.error('/workers error:', err);
    res.status(500).json({ error: 'Failed to fetch workers' });
  }
});

// GET /workers/profile - Own profile (authenticated worker)
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'worker') return res.status(403).json({ error: 'Worker access only' });
    const db     = getDb();
    const worker = await getRow(db, `
      SELECT u.id, u.name, u.phone, u.created_at,
             w.category, w.daily_rate, w.is_available, w.lat, w.lng,
             w.rank_level, w.points, w.total_jobs, w.completion_rate,
             w.aadhaar_verified, w.bio,
             COALESCE(AVG(r.score),0) AS avg_rating, COUNT(r.id) AS rating_count
      FROM workers w JOIN users u ON u.id=w.user_id
      LEFT JOIN ratings r ON r.rated_id=u.id
      WHERE w.user_id=?`, [req.user.id]);
    db.close();
    if (!worker) return res.status(404).json({ error: 'Worker profile not found' });
    res.json({ success: true, worker });
  } catch (err) {
    console.error('/workers/profile GET error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PUT /workers/profile - Update profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'worker') return res.status(403).json({ error: 'Worker access only' });
    const { category, daily_rate, bio, lat, lng } = req.body;
    const db = getDb();
    await runQuery(db,
      'UPDATE workers SET category=COALESCE(?,category), daily_rate=COALESCE(?,daily_rate), bio=COALESCE(?,bio), lat=COALESCE(?,lat), lng=COALESCE(?,lng) WHERE user_id=?',
      [category || null, daily_rate ? parseFloat(daily_rate) : null, bio || null,
       lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null, req.user.id]);
    if (req.user.name && req.body.name) {
      await runQuery(db, 'UPDATE users SET name=? WHERE id=?', [req.body.name.trim(), req.user.id]);
    }
    db.close();
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    console.error('/workers/profile PUT error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /workers/availability
router.put('/availability', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'worker') return res.status(403).json({ error: 'Worker access only' });
    const { is_available, lat, lng } = req.body;
    const db = getDb();
    await runQuery(db,
      'UPDATE workers SET is_available=?, lat=COALESCE(?,lat), lng=COALESCE(?,lng) WHERE user_id=?',
      [is_available ? 1 : 0, lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null, req.user.id]);
    db.close();
    res.json({ success: true, is_available: !!is_available });
  } catch (err) {
    console.error('/workers/availability error:', err);
    res.status(500).json({ error: 'Failed to update availability' });
  }
});

// GET /workers/jobs - View jobs dispatched to this worker
router.get('/jobs', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'worker') return res.status(403).json({ error: 'Worker access only' });
    const db   = getDb();
    const jobs = await getAll(db, `
      SELECT j.*, ja.status AS application_status, ja.applied_at,
             u.name AS customer_name
      FROM job_applications ja
      JOIN jobs j ON j.id = ja.job_id
      JOIN users u ON u.id = j.customer_id
      WHERE ja.worker_id = ?
      ORDER BY ja.applied_at DESC`, [req.user.id]);
    db.close();
    res.json({ success: true, jobs });
  } catch (err) {
    console.error('/workers/jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// GET /workers/stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'worker') return res.status(403).json({ error: 'Worker access only' });
    const db = getDb();
    const [worker, completedJobs, recentRatings] = await Promise.all([
      getRow(db, 'SELECT * FROM workers WHERE user_id=?', [req.user.id]),
      getAll(db, `SELECT id, created_at FROM jobs WHERE assigned_worker=? AND status='completed'`, [req.user.id]),
      getAll(db, `SELECT score, review, created_at FROM ratings WHERE rated_id=? ORDER BY created_at DESC LIMIT 10`, [req.user.id]),
    ]);
    db.close();
    res.json({ success: true, stats: { worker, completed_jobs: completedJobs, recent_ratings: recentRatings } });
  } catch (err) {
    console.error('/workers/stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
