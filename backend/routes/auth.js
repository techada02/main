/**
 * Authentication Routes
 * - POST /auth/send-otp   → Send OTP for registration/login
 * - POST /auth/verify-otp → Verify OTP and return JWT
 * - POST /auth/register   → Complete registration (worker or customer)
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { getDb, runQuery, getRow } = require('../db/setup');
const { generateOTP, otpExpiry, sendOTPSMS, formatIndianPhone } = require('../utils/sms');
const { signToken } = require('../middleware/auth');

// POST /auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { phone, name, role } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    const formattedPhone = formatIndianPhone(phone);
    const otp    = generateOTP();
    const expiry = otpExpiry(10);
    const db     = getDb();

    // Check if user exists
    const existing = await getRow(db, 'SELECT id FROM users WHERE phone=?', [formattedPhone]);

    if (existing) {
      // Update OTP for existing user
      await runQuery(db, 'UPDATE users SET otp=?, otp_expiry=? WHERE phone=?',
        [otp, expiry, formattedPhone]);
    } else {
      if (!name || !role) {
        db.close();
        return res.status(400).json({ error: 'Name and role required for new registration' });
      }
      if (!['worker', 'customer'].includes(role)) {
        db.close();
        return res.status(400).json({ error: 'Role must be worker or customer' });
      }
      await runQuery(db,
        'INSERT INTO users (id, phone, name, role, otp, otp_expiry) VALUES (?,?,?,?,?,?)',
        [uuidv4(), formattedPhone, name.trim(), role, otp, expiry]);
    }

    db.close();

    // Send OTP via SMS
    await sendOTPSMS(formattedPhone, otp, 'registration');

    // In demo mode, return OTP in response (remove in production!)
    const isDemoMode = !process.env.TWILIO_ACCOUNT_SID;
    res.json({
      success: true,
      message: `OTP sent to ${formattedPhone}`,
      ...(isDemoMode && { demo_otp: otp }),
    });
  } catch (err) {
    console.error('/auth/send-otp error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

    const formattedPhone = formatIndianPhone(phone);
    const db   = getDb();
    const user = await getRow(db, 'SELECT * FROM users WHERE phone=?', [formattedPhone]);

    if (!user) {
      db.close();
      return res.status(404).json({ error: 'User not found. Please register first.' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (user.otp !== otp || user.otp_expiry < now) {
      db.close();
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Mark verified, clear OTP
    await runQuery(db, 'UPDATE users SET is_verified=1, otp=NULL, otp_expiry=NULL WHERE id=?', [user.id]);

    // Check if worker profile exists
    const workerProfile = await getRow(db, 'SELECT * FROM workers WHERE user_id=?', [user.id]);
    db.close();

    const token = signToken({ id: user.id, phone: user.phone, role: user.role, name: user.name });

    res.json({
      success: true,
      token,
      user: {
        id:         user.id,
        name:       user.name,
        phone:      user.phone,
        role:       user.role,
        has_profile: !!workerProfile,
      },
    });
  } catch (err) {
    console.error('/auth/verify-otp error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /auth/register - Complete worker profile setup
router.post('/register-worker', async (req, res) => {
  try {
    const { phone, category, daily_rate, bio } = req.body;
    if (!phone || !category || !daily_rate) {
      return res.status(400).json({ error: 'phone, category and daily_rate are required' });
    }

    const formattedPhone = formatIndianPhone(phone);
    const db   = getDb();
    const user = await getRow(db, 'SELECT * FROM users WHERE phone=? AND role="worker" AND is_verified=1', [formattedPhone]);

    if (!user) {
      db.close();
      return res.status(404).json({ error: 'Verified worker account not found. Complete OTP verification first.' });
    }

    const existing = await getRow(db, 'SELECT user_id FROM workers WHERE user_id=?', [user.id]);
    if (existing) {
      await runQuery(db, 'UPDATE workers SET category=?, daily_rate=?, bio=? WHERE user_id=?',
        [category, parseFloat(daily_rate), bio || null, user.id]);
    } else {
      await runQuery(db,
        'INSERT INTO workers (user_id, category, daily_rate, bio) VALUES (?,?,?,?)',
        [user.id, category, parseFloat(daily_rate), bio || null]);
    }
    db.close();

    res.json({ success: true, message: 'Worker profile saved' });
  } catch (err) {
    console.error('/auth/register-worker error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

module.exports = router;
