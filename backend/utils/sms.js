/**
 * SMS / Keypad Phone Utility
 * Handles OTP generation and SMS dispatch (Twilio-ready)
 * Falls back to console logging when Twilio is not configured
 */
const crypto = require('crypto');

/**
 * Generate a 6-digit OTP
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generate OTP expiry timestamp (default: 10 minutes)
 */
function otpExpiry(minutes = 10) {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

/**
 * Send SMS via Twilio (if configured) or log to console
 * @param {string} to - Recipient phone number in E.164 format (+91XXXXXXXXXX)
 * @param {string} body - SMS message text
 */
async function sendSMS(to, body) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;

  if (sid && token && from) {
    try {
      const twilio = require('twilio');
      const client = twilio(sid, token);
      const msg = await client.messages.create({ body, from, to });
      console.log(`[SMS] Sent to ${to} | SID: ${msg.sid}`);
      return { success: true, sid: msg.sid };
    } catch (err) {
      console.error(`[SMS] Twilio error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // Dev/demo mode – log to console
  console.log(`[SMS DEMO] To: ${to}\n           Message: ${body}`);
  return { success: true, demo: true };
}

/**
 * Send job dispatch SMS to a worker
 */
async function sendJobDispatchSMS(workerPhone, workerName, jobTitle, category, address, jobId) {
  const body =
    `Hi ${workerName}! New ${category} job: "${jobTitle}" near ${address}. ` +
    `Reply YES to accept (Job ID: ${jobId.substring(0, 8)}). First to reply wins!`;
  return sendSMS(workerPhone, body);
}

/**
 * Send OTP SMS for registration or job verification
 */
async function sendOTPSMS(phone, otp, purpose = 'verification') {
  const purposeMap = {
    registration: 'registration',
    job_start: 'to start the job',
    job_complete: 'to complete the job',
    verification: 'verification',
  };
  const body = `Your KaamMitra ${purposeMap[purpose] || purpose} OTP is: ${otp}. Valid for 10 minutes. Do not share.`;
  return sendSMS(phone, body);
}

/**
 * Send notification SMS to admin
 */
async function sendAdminNotification(body) {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone) return { success: false, reason: 'ADMIN_PHONE not set' };
  return sendSMS(adminPhone, body);
}

/**
 * Format phone number to E.164 (Indian numbers)
 * Accepts: 9876543210, +919876543210, 919876543210
 */
function formatIndianPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 10) return `+91${cleaned}`;
  return `+${cleaned}`;
}

/**
 * Generate a unique confirmation ID for missed-call system
 */
function generateConfirmationId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

module.exports = {
  generateOTP,
  otpExpiry,
  sendSMS,
  sendJobDispatchSMS,
  sendOTPSMS,
  sendAdminNotification,
  formatIndianPhone,
  generateConfirmationId,
};
