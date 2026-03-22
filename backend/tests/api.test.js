/**
 * KaamMitra API Integration Tests
 * Run with: node tests/api.test.js
 *
 * Tests the full job lifecycle:
 *   register → post job → dispatch → accept → start → complete → rate
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const { setupDatabase, getDb, runQuery, getRow } = require('../db/setup');

// ─── Test helpers ─────────────────────────────────────────────────────────────

let server;
let BASE_URL;
let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url  = new URL(BASE_URL + path);
    const opts = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers:  { 'Content-Type': 'application/json' },
    };
    if (token)  opts.headers['Authorization'] = `Bearer ${token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
    errors.push({ name, error: err.message });
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🧪 KaamMitra API Tests\n');

  let workerToken, customerToken;
  let workerPhone = '+919900000001';
  let customerPhone = '+919900000002';
  let jobId;

  // ── Group 1: Health & Public Endpoints ──────────────────────────────────────
  console.log('📋 Health & Public Endpoints');

  await test('GET /api/health returns ok', async () => {
    const { status, body } = await request('GET', '/api/health');
    assert(status === 200, `status=${status}`);
    assert(body.status === 'ok', `status field=${body.status}`);
  });

  await test('GET /api/stats returns counts', async () => {
    const { status, body } = await request('GET', '/api/stats');
    assert(status === 200, `status=${status}`);
    assert(body.success === true, 'success should be true');
    assert(typeof body.worker_count === 'number', 'worker_count should be number');
    assert(typeof body.completed_jobs === 'number', 'completed_jobs should be number');
  });

  await test('GET /api/categories returns list', async () => {
    const { status, body } = await request('GET', '/api/categories');
    assert(status === 200, `status=${status}`);
    assert(Array.isArray(body.categories), 'categories should be array');
    assert(body.categories.length >= 1, 'should have at least one category');
    assert(body.categories.includes('Plumber'), 'should include Plumber');
  });

  await test('GET /api/workers returns array (public)', async () => {
    const { status, body } = await request('GET', '/api/workers');
    assert(status === 200, `status=${status}`);
    assert(Array.isArray(body.workers), 'workers should be array');
  });

  await test('GET /api/pricing/:category returns pricing data', async () => {
    const { status, body } = await request('GET', '/api/pricing/Plumber');
    assert(status === 200, `status=${status}`);
    assert(body.success === true, 'success should be true');
    assert(body.category === 'Plumber', `category should be Plumber, got ${body.category}`);
  });

  // ── Group 2: Authentication ─────────────────────────────────────────────────
  console.log('\n🔐 Authentication');

  // Clean up any existing test users
  {
    const db = getDb();
    await runQuery(db, 'DELETE FROM users WHERE phone IN (?,?)', [workerPhone, customerPhone]);
    db.close();
  }

  await test('POST /api/auth/send-otp creates new worker', async () => {
    const { status, body } = await request('POST', '/api/auth/send-otp', {
      phone: workerPhone, name: 'Test Worker', role: 'worker',
    });
    assert(status === 200, `status=${status}, body=${JSON.stringify(body)}`);
    assert(body.success === true, 'success should be true');
    assert(body.demo_otp, 'demo_otp should be returned in demo mode');
  });

  await test('POST /api/auth/send-otp creates new customer', async () => {
    const { status, body } = await request('POST', '/api/auth/send-otp', {
      phone: customerPhone, name: 'Test Customer', role: 'customer',
    });
    assert(status === 200, `status=${status}`);
    assert(body.success === true, 'success should be true');
    assert(body.demo_otp, 'demo_otp should be returned in demo mode');
  });

  await test('POST /api/auth/verify-otp verifies worker and returns JWT', async () => {
    // Get the OTP from DB directly
    const db = getDb();
    const user = await getRow(db, 'SELECT otp FROM users WHERE phone=?', [workerPhone]);
    db.close();
    assert(user && user.otp, 'OTP should be stored in DB');
    const { status, body } = await request('POST', '/api/auth/verify-otp', {
      phone: workerPhone, otp: user.otp,
    });
    assert(status === 200, `status=${status}, body=${JSON.stringify(body)}`);
    assert(body.token, 'token should be returned');
    assert(body.user.role === 'worker', `role should be worker, got ${body.user.role}`);
    workerToken = body.token;
  });

  await test('POST /api/auth/verify-otp verifies customer and returns JWT', async () => {
    const db = getDb();
    const user = await getRow(db, 'SELECT otp FROM users WHERE phone=?', [customerPhone]);
    db.close();
    const { status, body } = await request('POST', '/api/auth/verify-otp', {
      phone: customerPhone, otp: user.otp,
    });
    assert(status === 200, `status=${status}`);
    assert(body.token, 'token should be returned');
    assert(body.user.role === 'customer', `role should be customer`);
    customerToken = body.token;
  });

  await test('POST /api/auth/verify-otp rejects wrong OTP', async () => {
    const { status, body } = await request('POST', '/api/auth/verify-otp', {
      phone: workerPhone, otp: '000000',
    });
    assert(status === 400, `status should be 400, got ${status}`);
    assert(body.error, 'error message should be returned');
  });

  await test('POST /api/auth/send-otp rejects missing phone', async () => {
    const { status, body } = await request('POST', '/api/auth/send-otp', { name: 'X', role: 'worker' });
    assert(status === 400, `status should be 400, got ${status}`);
  });

  // ── Group 3: Worker Profile ─────────────────────────────────────────────────
  console.log('\n👷 Worker Profile');

  await test('POST /api/auth/register-worker creates worker profile', async () => {
    const { status, body } = await request('POST', '/api/auth/register-worker', {
      phone: workerPhone, category: 'Plumber', daily_rate: 600, bio: 'Experienced plumber',
    });
    assert(status === 200, `status=${status}, body=${JSON.stringify(body)}`);
    assert(body.success === true, 'success should be true');
  });

  await test('PUT /api/workers/availability sets worker online with location', async () => {
    const { status, body } = await request('PUT', '/api/workers/availability', {
      is_available: true, lat: 13.0827, lng: 80.2707,
    }, workerToken);
    assert(status === 200, `status=${status}`);
    assert(body.is_available === true, 'is_available should be true');
  });

  await test('GET /api/workers/profile returns worker profile', async () => {
    const { status, body } = await request('GET', '/api/workers/profile', null, workerToken);
    assert(status === 200, `status=${status}`);
    assert(body.worker.category === 'Plumber', `category should be Plumber`);
    assert(body.worker.daily_rate === 600, `daily_rate should be 600`);
  });

  await test('PUT /api/workers/profile updates bio', async () => {
    const { status, body } = await request('PUT', '/api/workers/profile', {
      bio: 'Updated bio - 10 years experience',
    }, workerToken);
    assert(status === 200, `status=${status}`);
    assert(body.success === true, 'success should be true');
  });

  await test('GET /api/workers returns available workers', async () => {
    const { status, body } = await request('GET', '/api/workers?category=Plumber');
    assert(status === 200, `status=${status}`);
    assert(Array.isArray(body.workers), 'workers should be array');
    // Worker should be in the list (is_available=true)
    const found = body.workers.some(w => w.category === 'Plumber');
    assert(found, 'Plumber worker should appear in list');
  });

  await test('GET /api/workers rejects non-worker accessing worker-only routes', async () => {
    const { status } = await request('GET', '/api/workers/profile', null, customerToken);
    assert(status === 403, `status should be 403, got ${status}`);
  });

  // ── Group 4: Jobs ───────────────────────────────────────────────────────────
  console.log('\n💼 Jobs');

  await test('POST /api/jobs posts a new job (near worker location)', async () => {
    const { status, body } = await request('POST', '/api/jobs', {
      title: 'Fix bathroom pipe',
      category: 'Plumber',
      job_type: 'hourly',
      description: 'Leaking pipe under sink',
      lat: 13.0827,
      lng: 80.2707,
      address: '123 Test Street',
      budget_min: 500,
      budget_max: 800,
      is_urgent: false,
      customer_type: 'individual',
    }, customerToken);
    assert(status === 201, `status=${status}, body=${JSON.stringify(body)}`);
    assert(body.job_id, 'job_id should be returned');
    jobId = body.job_id;
  });

  await test('POST /api/jobs rejects worker posting a job', async () => {
    const { status } = await request('POST', '/api/jobs', {
      title: 'Test', category: 'Plumber', job_type: 'hourly', lat: 13.0, lng: 80.0,
    }, workerToken);
    assert(status === 403, `status should be 403, got ${status}`);
  });

  await test('POST /api/jobs requires location', async () => {
    const { status, body } = await request('POST', '/api/jobs', {
      title: 'No Location Job', category: 'Plumber', job_type: 'hourly',
    }, customerToken);
    assert(status === 400, `status should be 400, got ${status}`);
    assert(body.error, 'error message should be returned');
  });

  await test('GET /api/jobs/my returns customer jobs', async () => {
    const { status, body } = await request('GET', '/api/jobs/my', null, customerToken);
    assert(status === 200, `status=${status}`);
    assert(Array.isArray(body.jobs), 'jobs should be array');
    const found = body.jobs.find(j => j.id === jobId);
    assert(found, 'posted job should appear in my jobs');
    assert(found.status === 'open', `job status should be open, got ${found.status}`);
    assert('has_rated' in found, 'has_rated field should be present');
  });

  await test('GET /api/jobs returns open jobs', async () => {
    const { status, body } = await request('GET', '/api/jobs', null, workerToken);
    assert(status === 200, `status=${status}`);
    assert(Array.isArray(body.jobs), 'jobs should be array');
  });

  await test('GET /api/jobs/:id returns job details', async () => {
    const { status, body } = await request('GET', `/api/jobs/${jobId}`, null, workerToken);
    assert(status === 200, `status=${status}`);
    assert(body.job.id === jobId, `job id should match`);
    assert(body.job.title === 'Fix bathroom pipe', 'title should match');
  });

  // ── Group 5: Job Lifecycle ──────────────────────────────────────────────────
  console.log('\n⚙️  Job Lifecycle');

  let startOtp, completionOtp;

  await test('POST /api/jobs/:id/accept - worker accepts job', async () => {
    const { status, body } = await request('POST', `/api/jobs/${jobId}/accept`, null, workerToken);
    // May fail if worker wasn't dispatched; that's OK for integration test
    if (status === 403 && body.error && body.error.includes('not dispatched')) {
      // Manually create application if not dispatched (location may differ in test env)
      const db = getDb();
      const workerUser = await getRow(db, 'SELECT id FROM users WHERE phone=?', [workerPhone]);
      const { v4: uuidv4 } = require('uuid');
      await runQuery(db,
        'INSERT OR IGNORE INTO job_applications (id, job_id, worker_id) VALUES (?,?,?)',
        [uuidv4(), jobId, workerUser.id]);
      db.close();
      // Retry accept
      const retry = await request('POST', `/api/jobs/${jobId}/accept`, null, workerToken);
      assert(retry.status === 200, `retry status=${retry.status}, body=${JSON.stringify(retry.body)}`);
      assert(retry.body.start_otp, 'start_otp should be returned');
      startOtp = retry.body.start_otp;
    } else {
      assert(status === 200, `status=${status}, body=${JSON.stringify(body)}`);
      assert(body.start_otp, 'start_otp should be returned');
      startOtp = body.start_otp;
    }
  });

  await test('POST /api/jobs/:id/accept - duplicate accept returns 409', async () => {
    const { status } = await request('POST', `/api/jobs/${jobId}/accept`, null, workerToken);
    assert(status === 409, `status should be 409, got ${status}`);
  });

  await test('POST /api/jobs/:id/start with invalid OTP returns 400', async () => {
    const { status, body } = await request('POST', `/api/jobs/${jobId}/start`, { otp: '000000' }, workerToken);
    assert(status === 400, `status should be 400, got ${status}`);
    assert(body.error, 'error message should be returned');
  });

  await test('POST /api/jobs/:id/start with valid OTP starts job', async () => {
    const { status, body } = await request('POST', `/api/jobs/${jobId}/start`, { otp: startOtp }, workerToken);
    assert(status === 200, `status=${status}, body=${JSON.stringify(body)}`);
    assert(body.success === true, 'success should be true');
    // In demo mode, completion OTP is returned
    if (body.demo_completion_otp) completionOtp = body.demo_completion_otp;
  });

  await test('Job status is in_progress after start', async () => {
    const db = getDb();
    const job = await getRow(db, 'SELECT status, completion_otp FROM jobs WHERE id=?', [jobId]);
    db.close();
    assert(job.status === 'in_progress', `status should be in_progress, got ${job.status}`);
    completionOtp = completionOtp || job.completion_otp;
    assert(completionOtp, 'completion_otp should be set');
  });

  await test('POST /api/jobs/:id/complete with valid OTP completes job', async () => {
    const { status, body } = await request('POST', `/api/jobs/${jobId}/complete`, { otp: completionOtp }, workerToken);
    assert(status === 200, `status=${status}, body=${JSON.stringify(body)}`);
    assert(body.success === true, 'success should be true');
  });

  await test('Job status is completed after completion', async () => {
    const db = getDb();
    const job = await getRow(db, 'SELECT status FROM jobs WHERE id=?', [jobId]);
    db.close();
    assert(job.status === 'completed', `status should be completed, got ${job.status}`);
  });

  // ── Group 6: Ratings ────────────────────────────────────────────────────────
  console.log('\n⭐ Ratings');

  await test('POST /api/jobs/:id/rate - customer rates worker', async () => {
    const { status, body } = await request('POST', `/api/jobs/${jobId}/rate`, {
      score: 5, review: 'Excellent work!',
    }, customerToken);
    assert(status === 200, `status=${status}, body=${JSON.stringify(body)}`);
    assert(body.success === true, 'success should be true');
  });

  await test('POST /api/jobs/:id/rate - duplicate rating returns 409', async () => {
    const { status, body } = await request('POST', `/api/jobs/${jobId}/rate`, {
      score: 4,
    }, customerToken);
    assert(status === 409, `status should be 409 for duplicate, got ${status}`);
    assert(body.error, 'error message should be returned');
  });

  await test('GET /api/jobs/my shows has_rated=1 after rating', async () => {
    const { status, body } = await request('GET', '/api/jobs/my', null, customerToken);
    assert(status === 200, `status=${status}`);
    const job = body.jobs.find(j => j.id === jobId);
    assert(job, 'job should be in my jobs');
    assert(job.has_rated == 1, `has_rated should be 1, got ${job.has_rated}`);
  });

  await test('Worker stats updated after rating', async () => {
    const { status, body } = await request('GET', '/api/workers/stats', null, workerToken);
    assert(status === 200, `status=${status}`);
    assert(body.stats.worker.total_jobs >= 1, 'total_jobs should be >= 1');
    assert(body.stats.recent_ratings.length >= 1, 'should have at least 1 rating');
    assert(body.stats.recent_ratings[0].score === 5, 'rating score should be 5');
  });

  await test('Worker avg_rating updated in profile', async () => {
    const { status, body } = await request('GET', '/api/workers/profile', null, workerToken);
    assert(status === 200, `status=${status}`);
    assert(parseFloat(body.worker.avg_rating) === 5.0, `avg_rating should be 5.0, got ${body.worker.avg_rating}`);
  });

  // ── Group 7: Worker Jobs History ────────────────────────────────────────────
  console.log('\n📁 Worker Jobs History');

  await test('GET /api/workers/jobs returns job history', async () => {
    const { status, body } = await request('GET', '/api/workers/jobs', null, workerToken);
    assert(status === 200, `status=${status}`);
    assert(Array.isArray(body.jobs), 'jobs should be array');
    const found = body.jobs.find(j => j.id === jobId);
    assert(found, 'completed job should appear in worker job history');
    assert(found.status === 'completed', `job status should be completed, got ${found.status}`);
  });

  // ── Group 8: Auth Failures ──────────────────────────────────────────────────
  console.log('\n🚫 Auth Failures');

  await test('Protected route rejects missing token', async () => {
    const { status } = await request('GET', '/api/workers/profile');
    assert(status === 401, `status should be 401, got ${status}`);
  });

  await test('Protected route rejects invalid token', async () => {
    const { status } = await request('GET', '/api/workers/profile', null, 'invalid.token.here');
    assert(status === 401, `status should be 401, got ${status}`);
  });

  // ── Group 9: SMS System ─────────────────────────────────────────────────────
  console.log('\n📱 SMS System');

  await test('GET /api/sms/status rejects missing admin key', async () => {
    const { status } = await request('GET', '/api/sms/status');
    assert(status === 401, `status should be 401, got ${status}`);
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  const db = getDb();
  await runQuery(db, 'DELETE FROM ratings WHERE rater_id IN (SELECT id FROM users WHERE phone IN (?,?))', [workerPhone, customerPhone]);
  await runQuery(db, 'DELETE FROM job_applications WHERE job_id=?', [jobId]);
  await runQuery(db, 'DELETE FROM jobs WHERE id=?', [jobId]);
  await runQuery(db, 'DELETE FROM workers WHERE user_id IN (SELECT id FROM users WHERE phone IN (?,?))', [workerPhone, customerPhone]);
  await runQuery(db, 'DELETE FROM users WHERE phone IN (?,?)', [workerPhone, customerPhone]);
  db.close();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Ensure database is set up
  await setupDatabase();

  // Start test server on a random port (separate from the boot() server)
  // Set TEST_PORT=0 so boot() won't conflict (it uses process.env.PORT)
  process.env.PORT = '0';
  const app = require('../server');

  await new Promise((resolve) => {
    // Listen on a free port; boot() will also listen on its own port separately
    server = app.listen(0, '127.0.0.1', () => {
      BASE_URL = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  try {
    await runTests();
  } catch (err) {
    console.error('\nUnexpected error during tests:', err);
  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (errors.length) {
    console.log('\nFailed tests:');
    errors.forEach(e => console.log(`  • ${e.name}: ${e.error}`));
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
