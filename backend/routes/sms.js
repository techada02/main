/**
 * SMS / Keypad Phone Confirmation Routes
 * Handles incoming SMS replies from keypad phone users (Twilio webhook)
 *
 * - POST /sms/webhook        → Twilio incoming SMS webhook
 * - POST /sms/bulk-send      → Send job notification to all unconfirmed workers
 * - GET  /sms/status         → Admin status check (who hasn't confirmed)
 * - POST /sms/setup-worker   → Register a keypad phone worker in the confirmation table
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router  = express.Router();

const { getDb, runQuery, getRow, getAll } = require('../db/setup');
const { sendSMS, sendAdminNotification, formatIndianPhone } = require('../utils/sms');

// POST /sms/webhook - Twilio SMS webhook (handles keypad phone replies)
router.post('/webhook', async (req, res) => {
  try {
    const from        = req.body.From || '';
    const messageBody = (req.body.Body || '').trim().toUpperCase();

    const db = getDb();

    // --- ADMIN STATUS CHECK ---
    const adminPhone = process.env.ADMIN_PHONE ? formatIndianPhone(process.env.ADMIN_PHONE) : null;
    if (messageBody === 'STATUS' && adminPhone && from === adminPhone) {
      const pending = await getAll(db,
        'SELECT name, phone_number FROM sms_confirmations WHERE confirmed=0');
      const msg = pending.length
        ? `Pending confirmations (${pending.length}):\n` + pending.map(u => `${u.name} (${u.phone_number})`).join(', ')
        : 'All workers have confirmed!';
      db.close();
      return res.set('Content-Type', 'text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`
      );
    }

    // --- JOB ACCEPTANCE / CONFIRMATION ---
    const record = await getRow(db,
      'SELECT * FROM sms_confirmations WHERE phone_number=? ORDER BY created_at DESC LIMIT 1',
      [from]);

    let replyText;

    if (!record) {
      replyText = 'Your number is not registered. Download KaamMitra app or contact support.';
    } else if (record.confirmed === 1) {
      replyText = `Hi ${record.name}, you have already confirmed. No further changes can be made.`;
    } else if (messageBody === 'YES' || messageBody === '1') {
      // Accept confirmation
      const now = Math.floor(Date.now() / 1000);
      await runQuery(db,
        'UPDATE sms_confirmations SET confirmed=1, confirmed_at=? WHERE id=?',
        [now, record.id]);

      // If this is a job application, accept the job
      if (record.job_id) {
        const job = await getRow(db, 'SELECT * FROM jobs WHERE id=? AND status="open"', [record.job_id]);
        if (job) {
          // Find the worker's user record
          const worker = await getRow(db, 'SELECT id FROM users WHERE phone=?', [from]);
          if (worker) {
            await runQuery(db,
              'UPDATE jobs SET status="assigned", assigned_worker=? WHERE id=? AND status="open"',
              [worker.id, record.job_id]);
          }
        }
      }

      // Notify admin
      sendAdminNotification(`CONFIRMED: ${record.name} (${from}) confirmed via SMS.`)
        .catch(() => {});

      // Notify original sender (e.g., customer who posted job)
      if (record.sender_phone) {
        sendSMS(record.sender_phone,
          `UPDATE: ${record.name} has confirmed your job request! They are on their way.`
        ).catch(() => {});
      }

      replyText = `Thank you ${record.name}! Your confirmation has been received. Please go to the job location.`;
    } else if (messageBody === 'NO' || messageBody === '2') {
      replyText = `Hi ${record.name}, job declined. We'll notify another worker.`;
    } else {
      replyText = `Hi ${record.name}, reply YES (or 1) to accept the job, or NO (or 2) to decline.`;
    }

    db.close();

    res.set('Content-Type', 'text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${replyText}</Message></Response>`
    );
  } catch (err) {
    console.error('/sms/webhook error:', err);
    res.set('Content-Type', 'text/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Service error. Please try again.</Message></Response>'
    );
  }
});

// POST /sms/setup-worker - Register a keypad phone worker
router.post('/setup-worker', async (req, res) => {
  try {
    const { phone, name, job_id, sender_phone } = req.body;
    if (!phone || !name) return res.status(400).json({ error: 'phone and name are required' });

    const formattedPhone = formatIndianPhone(phone);
    const db = getDb();

    await runQuery(db, `
      INSERT INTO sms_confirmations (id, phone_number, name, job_id, sender_phone)
      VALUES (?,?,?,?,?)`,
      [uuidv4(), formattedPhone, name.trim(), job_id || null, sender_phone || null]);

    db.close();

    // Send invitation SMS
    const jobMsg = job_id ? ` for a job` : '';
    await sendSMS(formattedPhone,
      `Hi ${name}! You have a new work request${jobMsg} on KaamMitra. Reply YES to accept or NO to decline.`
    );

    res.json({ success: true, message: `Invitation sent to ${formattedPhone}` });
  } catch (err) {
    console.error('/sms/setup-worker error:', err);
    res.status(500).json({ error: 'Failed to setup worker notification' });
  }
});

// POST /sms/bulk-send - Send job notification to multiple keypad phone workers
router.post('/bulk-send', async (req, res) => {
  try {
    const { job_id, workers } = req.body;
    // workers: [{phone, name}]
    if (!Array.isArray(workers) || workers.length === 0) {
      return res.status(400).json({ error: 'workers array is required' });
    }

    const db = getDb();
    const results = [];

    for (const w of workers) {
      if (!w.phone || !w.name) continue;
      const phone = formatIndianPhone(w.phone);
      try {
        // Check if already registered
        const existing = await getRow(db,
          'SELECT id, confirmed FROM sms_confirmations WHERE phone_number=? AND job_id=?',
          [phone, job_id || null]);

        if (!existing) {
          await runQuery(db,
            'INSERT INTO sms_confirmations (id, phone_number, name, job_id) VALUES (?,?,?,?)',
            [uuidv4(), phone, w.name.trim(), job_id || null]);
        } else if (existing.confirmed === 1) {
          results.push({ phone, status: 'already_confirmed' });
          continue;
        }

        const result = await sendSMS(phone,
          `Hi ${w.name}! New work available. Reply YES to accept. - KaamMitra`);
        results.push({ phone, name: w.name, status: result.success ? 'sent' : 'failed' });
      } catch (e) {
        results.push({ phone, name: w.name, status: 'error', error: e.message });
      }
    }

    db.close();
    res.json({ success: true, results });
  } catch (err) {
    console.error('/sms/bulk-send error:', err);
    res.status(500).json({ error: 'Bulk send failed' });
  }
});

// GET /sms/status - Check confirmation status (admin use)
router.get('/status', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== (process.env.ADMIN_KEY || 'kaammitra_admin')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { job_id } = req.query;
    const db = getDb();
    let records;

    if (job_id) {
      records = await getAll(db,
        'SELECT * FROM sms_confirmations WHERE job_id=? ORDER BY created_at DESC', [job_id]);
    } else {
      records = await getAll(db,
        'SELECT * FROM sms_confirmations ORDER BY created_at DESC LIMIT 100');
    }
    db.close();

    const confirmed   = records.filter(r => r.confirmed === 1);
    const unconfirmed = records.filter(r => r.confirmed === 0);

    res.json({
      success: true,
      total:       records.length,
      confirmed:   confirmed.length,
      unconfirmed: unconfirmed.length,
      pending:     unconfirmed.map(r => ({ name: r.name, phone: r.phone_number })),
      records,
    });
  } catch (err) {
    console.error('/sms/status error:', err);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

module.exports = router;
