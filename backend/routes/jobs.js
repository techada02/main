/**
 * Job Routes
 * - POST /jobs              → Post a new job (customer)
 * - GET  /jobs              → List open jobs
 * - GET  /jobs/:id          → Get job details
 * - POST /jobs/:id/accept   → Worker accepts a dispatched job
 * - POST /jobs/:id/start    → Start job with OTP
 * - POST /jobs/:id/complete → Complete job with OTP
 * - POST /jobs/:id/rate     → Rate worker / customer
 * - GET  /jobs/my           → Jobs posted by the logged-in customer
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router  = express.Router();

const { getDb, runQuery, getRow, getAll } = require('../db/setup');
const { authMiddleware }  = require('../middleware/auth');
const { haversineKm }     = require('../utils/geo');
const { dispatchScore }   = require('../utils/ranking');
const { getRankLevel, calculateJobPoints } = require('../utils/ranking');
const { sendJobDispatchSMS, sendSMS, generateOTP } = require('../utils/sms');

const DISPATCH_RADIUS_KM = 5;
const TOP_N_WORKERS      = 10;

// POST /jobs - Create a job
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'customer') return res.status(403).json({ error: 'Customer access only' });

    const {
      title, category, job_type, description,
      lat, lng, address,
      budget_min, budget_max, duration,
      is_urgent, customer_type,
    } = req.body;

    if (!title || !category || !job_type || !lat || !lng) {
      return res.status(400).json({ error: 'title, category, job_type, lat and lng are required' });
    }
    const validJobTypes = ['hourly', 'per_unit', 'full_day', 'custom'];
    if (!validJobTypes.includes(job_type)) {
      return res.status(400).json({ error: `job_type must be one of: ${validJobTypes.join(', ')}` });
    }

    const jobId = uuidv4();
    const db    = getDb();

    await runQuery(db, `
      INSERT INTO jobs (id, customer_id, title, category, job_type, description,
                        lat, lng, address, budget_min, budget_max, duration,
                        is_urgent, customer_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [jobId, req.user.id, title.trim(), category, job_type,
       description || null, parseFloat(lat), parseFloat(lng),
       address || null,
       budget_min ? parseFloat(budget_min) : null,
       budget_max ? parseFloat(budget_max) : null,
       duration || null,
       is_urgent ? 1 : 0,
       customer_type || 'individual']);

    // Dispatch to nearby workers
    const workers = await getAll(db, `
      SELECT u.id, u.name, u.phone, w.category,
             w.rank_level, w.points, w.completion_rate, w.lat, w.lng
      FROM workers w JOIN users u ON u.id=w.user_id
      WHERE u.is_verified=1 AND w.is_available=1
        AND (w.category=? OR w.category='general')
        AND w.lat IS NOT NULL AND w.lng IS NOT NULL`,
      [category]);

    const jobLat = parseFloat(lat);
    const jobLng = parseFloat(lng);

    // Filter by radius and compute dispatch score
    const nearbyWorkers = workers
      .map(w => ({ ...w, distance_km: haversineKm(jobLat, jobLng, w.lat, w.lng) }))
      .filter(w => w.distance_km <= DISPATCH_RADIUS_KM)
      .sort((a, b) => dispatchScore(b) - dispatchScore(a))
      .slice(0, is_urgent ? TOP_N_WORKERS * 2 : TOP_N_WORKERS);

    // Create application records and send SMS notifications
    for (const worker of nearbyWorkers) {
      await runQuery(db,
        'INSERT OR IGNORE INTO job_applications (id, job_id, worker_id) VALUES (?,?,?)',
        [uuidv4(), jobId, worker.id]);

      // Send SMS to keypad phone workers
      sendJobDispatchSMS(
        worker.phone, worker.name, title, category,
        address || `${lat},${lng}`, jobId
      ).catch(err => console.error('SMS dispatch error:', err));
    }

    db.close();

    res.status(201).json({
      success: true,
      job_id: jobId,
      dispatched_to: nearbyWorkers.length,
      message: nearbyWorkers.length
        ? `Job posted and dispatched to ${nearbyWorkers.length} nearby worker(s)`
        : 'Job posted. No workers available in your area currently.',
    });
  } catch (err) {
    console.error('/jobs POST error:', err);
    res.status(500).json({ error: 'Failed to post job' });
  }
});

// GET /jobs - List open jobs (for worker discovery)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { category, status = 'open', lat, lng, radius = 10 } = req.query;
    const db = getDb();

    let sql = `
      SELECT j.*, u.name AS customer_name,
             COALESCE(AVG(r.score),0) AS customer_rating
      FROM jobs j
      JOIN users u ON u.id=j.customer_id
      LEFT JOIN ratings r ON r.rated_id=j.customer_id
      WHERE j.status=?`;
    const params = [status];

    if (category) { sql += ' AND j.category=?'; params.push(category); }

    sql += ' GROUP BY j.id ORDER BY j.is_urgent DESC, j.created_at DESC LIMIT 50';
    const jobs = await getAll(db, sql, params);
    db.close();

    let filtered = jobs;
    if (lat && lng) {
      const uLat = parseFloat(lat), uLng = parseFloat(lng), uRad = parseFloat(radius);
      filtered = jobs
        .map(j => ({ ...j, distance_km: Math.round(haversineKm(uLat, uLng, j.lat, j.lng) * 10) / 10 }))
        .filter(j => j.distance_km <= uRad)
        .sort((a, b) => b.is_urgent - a.is_urgent || a.distance_km - b.distance_km);
    }

    res.json({ success: true, jobs: filtered });
  } catch (err) {
    console.error('/jobs GET error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// GET /jobs/my - Jobs posted by logged-in customer
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const db   = getDb();
    const jobs = await getAll(db, `
      SELECT j.*, u.name AS worker_name,
             CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END AS has_rated
      FROM jobs j
      LEFT JOIN users u ON u.id=j.assigned_worker
      LEFT JOIN ratings r ON r.job_id=j.id AND r.rater_id=j.customer_id
      WHERE j.customer_id=?
      ORDER BY j.created_at DESC`, [req.user.id]);
    db.close();
    res.json({ success: true, jobs });
  } catch (err) {
    console.error('/jobs/my error:', err);
    res.status(500).json({ error: 'Failed to fetch your jobs' });
  }
});

// GET /jobs/:id - Get job details
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db  = getDb();
    const job = await getRow(db, `
      SELECT j.*, u.name AS customer_name, u.phone AS customer_phone,
             wu.name AS worker_name, wu.phone AS worker_phone,
             w.rank_level, w.points, COALESCE(AVG(r.score),0) AS worker_rating
      FROM jobs j
      JOIN users u ON u.id=j.customer_id
      LEFT JOIN users wu ON wu.id=j.assigned_worker
      LEFT JOIN workers w ON w.user_id=j.assigned_worker
      LEFT JOIN ratings r ON r.rated_id=j.assigned_worker
      WHERE j.id=?`, [req.params.id]);
    db.close();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true, job });
  } catch (err) {
    console.error('/jobs/:id GET error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// POST /jobs/:id/accept - Worker accepts job
router.post('/:id/accept', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'worker') return res.status(403).json({ error: 'Worker access only' });

    const db  = getDb();
    const job = await getRow(db, 'SELECT * FROM jobs WHERE id=?', [req.params.id]);

    if (!job) { db.close(); return res.status(404).json({ error: 'Job not found' }); }
    if (job.status !== 'open') {
      // Mark this application as 'filled' for the worker
      await runQuery(db, 'UPDATE job_applications SET status="filled" WHERE job_id=? AND worker_id=?',
        [req.params.id, req.user.id]);
      db.close();
      return res.status(409).json({ error: 'Sorry, this job has already been filled.' });
    }

    // Check worker was dispatched
    const application = await getRow(db,
      'SELECT * FROM job_applications WHERE job_id=? AND worker_id=?',
      [req.params.id, req.user.id]);
    if (!application) { db.close(); return res.status(403).json({ error: 'You were not dispatched for this job' }); }

    const startOtp = generateOTP();

    // Assign job to this worker (atomic update)
    await runQuery(db, `
      UPDATE jobs SET status='assigned', assigned_worker=?, start_otp=?
      WHERE id=? AND status='open'`,
      [req.user.id, startOtp, req.params.id]);

    // Re-read to check if assignment succeeded
    const updatedJob = await getRow(db, 'SELECT assigned_worker, status FROM jobs WHERE id=?', [req.params.id]);
    if (updatedJob.assigned_worker !== req.user.id) {
      db.close();
      return res.status(409).json({ error: 'Job was taken by another worker just now' });
    }

    // Accept this application, reject others
    await runQuery(db, 'UPDATE job_applications SET status="accepted" WHERE job_id=? AND worker_id=?',
      [req.params.id, req.user.id]);
    await runQuery(db, 'UPDATE job_applications SET status="filled" WHERE job_id=? AND worker_id!=?',
      [req.params.id, req.user.id]);

    // Notify customer
    const customer = await getRow(db, 'SELECT name, phone FROM users WHERE id=?', [job.customer_id]);
    db.close();

    if (customer) {
      sendSMS(customer.phone,
        `Great news! ${req.user.name} has accepted your job "${job.title}". ` +
        `Job start OTP: ${startOtp}. Share this with the worker when they arrive.`
      ).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Job accepted! Go to the customer location.',
      start_otp: startOtp,
      job_title: job.title,
      address: job.address,
    });
  } catch (err) {
    console.error('/jobs/:id/accept error:', err);
    res.status(500).json({ error: 'Failed to accept job' });
  }
});

// POST /jobs/:id/start - Start job with OTP
router.post('/:id/start', authMiddleware, async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'OTP required to start job' });

    const db  = getDb();
    const job = await getRow(db, 'SELECT * FROM jobs WHERE id=?', [req.params.id]);

    if (!job) { db.close(); return res.status(404).json({ error: 'Job not found' }); }
    if (job.status !== 'assigned') { db.close(); return res.status(400).json({ error: 'Job is not in assigned state' }); }
    if (job.assigned_worker !== req.user.id) { db.close(); return res.status(403).json({ error: 'Not your job' }); }
    if (job.start_otp !== otp) { db.close(); return res.status(400).json({ error: 'Invalid start OTP' }); }

    const completionOtp = generateOTP();
    const now = Math.floor(Date.now() / 1000);

    await runQuery(db, `
      UPDATE jobs SET status='in_progress', started_at=?, completion_otp=?
      WHERE id=?`, [now, completionOtp, req.params.id]);

    // Send completion OTP to customer
    const customer = await getRow(db, 'SELECT name, phone FROM users WHERE id=?', [job.customer_id]);
    db.close();

    if (customer) {
      sendSMS(customer.phone,
        `Job "${job.title}" has started. ` +
        `When work is done, share this OTP with the worker to confirm completion: ${completionOtp}`
      ).catch(() => {});
    }

    const isDemoMode = !process.env.TWILIO_ACCOUNT_SID;
    res.json({
      success: true,
      message: 'Job started successfully!',
      ...(isDemoMode && { demo_completion_otp: completionOtp }),
    });
  } catch (err) {
    console.error('/jobs/:id/start error:', err);
    res.status(500).json({ error: 'Failed to start job' });
  }
});

// POST /jobs/:id/complete - Complete job with OTP
router.post('/:id/complete', authMiddleware, async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'OTP required to complete job' });

    const db  = getDb();
    const job = await getRow(db, 'SELECT * FROM jobs WHERE id=?', [req.params.id]);

    if (!job) { db.close(); return res.status(404).json({ error: 'Job not found' }); }
    if (job.status !== 'in_progress') { db.close(); return res.status(400).json({ error: 'Job is not in progress' }); }
    if (job.assigned_worker !== req.user.id) { db.close(); return res.status(403).json({ error: 'Not your job' }); }
    if (job.completion_otp !== otp) { db.close(); return res.status(400).json({ error: 'Invalid completion OTP' }); }

    const now = Math.floor(Date.now() / 1000);
    await runQuery(db, 'UPDATE jobs SET status="completed", completed_at=? WHERE id=?', [now, req.params.id]);
    await runQuery(db, 'UPDATE workers SET total_jobs=total_jobs+1 WHERE user_id=?', [req.user.id]);

    // Set worker back to available
    await runQuery(db, 'UPDATE workers SET is_available=1 WHERE user_id=?', [req.user.id]);

    const customer = await getRow(db, 'SELECT name, phone FROM users WHERE id=?', [job.customer_id]);
    db.close();

    if (customer) {
      sendSMS(customer.phone,
        `Job "${job.title}" completed by ${req.user.name}. Please rate your experience in the app.`
      ).catch(() => {});
    }

    res.json({ success: true, message: 'Job completed! Thank you.' });
  } catch (err) {
    console.error('/jobs/:id/complete error:', err);
    res.status(500).json({ error: 'Failed to complete job' });
  }
});

// POST /jobs/:id/rate - Rate worker or customer
router.post('/:id/rate', authMiddleware, async (req, res) => {
  try {
    const { score, review, rated_user_id } = req.body;
    if (!score || score < 1 || score > 5) {
      return res.status(400).json({ error: 'Score must be between 1 and 5' });
    }

    const db  = getDb();
    const job = await getRow(db, 'SELECT * FROM jobs WHERE id=?', [req.params.id]);

    if (!job) { db.close(); return res.status(404).json({ error: 'Job not found' }); }
    if (job.status !== 'completed') { db.close(); return res.status(400).json({ error: 'Can only rate completed jobs' }); }

    // Determine who is being rated
    let ratedId;
    if (req.user.role === 'customer') ratedId = job.assigned_worker;
    else if (req.user.role === 'worker') ratedId = job.customer_id;
    else { db.close(); return res.status(403).json({ error: 'Invalid role' }); }

    if (rated_user_id && rated_user_id !== ratedId) {
      db.close();
      return res.status(400).json({ error: 'Invalid rated_user_id for this job' });
    }

    // Check duplicate rating
    const existing = await getRow(db,
      'SELECT id FROM ratings WHERE job_id=? AND rater_id=?',
      [req.params.id, req.user.id]);
    if (existing) { db.close(); return res.status(409).json({ error: 'You have already rated this job' }); }

    await runQuery(db,
      'INSERT INTO ratings (id, job_id, rater_id, rated_id, score, review) VALUES (?,?,?,?,?,?)',
      [uuidv4(), req.params.id, req.user.id, ratedId, parseInt(score), review || null]);

    // Update worker points and rank
    if (req.user.role === 'customer') {
      const points = calculateJobPoints(parseInt(score), true);
      const worker = await getRow(db, 'SELECT points FROM workers WHERE user_id=?', [ratedId]);
      if (worker) {
        const newPoints = (worker.points || 0) + points;
        const newRank   = getRankLevel(newPoints);
        await runQuery(db, 'UPDATE workers SET points=?, rank_level=? WHERE user_id=?',
          [newPoints, newRank, ratedId]);
      }
    }

    db.close();
    res.json({ success: true, message: 'Rating submitted successfully' });
  } catch (err) {
    console.error('/jobs/:id/rate error:', err);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

module.exports = router;
