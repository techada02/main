# KaamMitra – Hybrid Labour Marketplace Platform

> **"Zomato/Uber model for daily wage workers"** – Location-based job dispatch + ranking + SMS for keypad phones.

## Project Overview

KaamMitra is a hybrid labour marketplace platform that connects daily wage workers (masons, plumbers, electricians, etc.) with customers. It works for both smartphone users (via web app) and keypad phone users (via SMS/missed call confirmation).

## Problem Statement

Daily wage workers in India face:
- No centralized platform to find work
- Dependence on middlemen with high commissions
- No digital identity or reputation system
- Workers without smartphones cannot access job platforms
- No transparent, market-based pricing

## Solution

A **Hybrid Labour Marketplace Platform** with:
- 📱 Web app for smartphone users
- 📞 SMS + keypad confirmation for basic phone users
- 📍 Location-based job dispatch (Uber-style)
- 💰 Market-based dynamic pricing
- 🏆 Worker ranking system (Bronze → Platinum)
- 🔐 OTP-verified job start/completion

---

## Tech Stack

| Layer      | Technology                                |
|------------|-------------------------------------------|
| Frontend   | HTML5 + CSS3 + Vanilla JS (responsive)    |
| Backend    | Node.js + Express.js                      |
| Database   | SQLite (via `sqlite3` npm package)        |
| Auth       | JWT (jsonwebtoken) + OTP via SMS          |
| SMS/USSD   | Twilio API (optional, falls back to console) |
| Location   | Browser Geolocation API + Haversine formula |

---

## Features

### Customer Features
- Register/login via phone OTP
- Post jobs (hourly, per-unit, full-day, custom)
- Select customer type (individual / contractor / company / local shop)
- Auto-detect or manual location input
- Mark job as **Urgent** (priority dispatch)
- View market-based pricing before posting
- Track job status in real-time

### Worker Features
- Register with category, daily rate, bio
- Toggle online/offline availability
- View nearby open jobs (location-filtered)
- Accept job with one click
- OTP-verified job start and completion
- Rank system: Bronze → Silver → Gold → Platinum
- Earnings and rating dashboard

### Keypad Phone Support (SMS System)
Workers with basic phones can:
1. Receive SMS: *"New Mason job near MG Road. Reply YES to accept."*
2. Reply `YES` (or `1`) to confirm
3. Backend locks the job and notifies the customer
4. No internet or app required

### Job Dispatch Algorithm
1. Customer posts job with location
2. Backend finds workers within 5 km radius
3. Workers sorted by: rank points × completion rate × distance
4. Top 10 workers notified (app notification + SMS)
5. First worker to accept gets the job
6. Others receive "Job Filled" notification

---

## Setup & Installation

### Prerequisites
- Node.js >= 18.0.0
- npm

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your values
```

**Required `.env` variables:**
```env
PORT=3000
JWT_SECRET=your_strong_secret_here

# Optional – SMS will be logged to console if not set
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Admin phone for STATUS checks
ADMIN_PHONE=+919876543210
ADMIN_KEY=your_admin_key
```

### 3. Start Server
```bash
cd backend
node server.js
```

Server runs on: `http://localhost:3000`

### 4. Access the App

| Page | URL |
|------|-----|
| Home / Landing | http://localhost:3000 |
| Customer Dashboard | http://localhost:3000/customer.html |
| Worker Dashboard | http://localhost:3000/worker.html |
| Browse Workers | http://localhost:3000/workers.html |
| API Health | http://localhost:3000/api/health |

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/send-otp` | Send OTP to phone |
| POST | `/api/auth/verify-otp` | Verify OTP → get JWT |
| POST | `/api/auth/register-worker` | Save worker profile |

### Workers
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/workers` | No | List available workers |
| GET | `/api/workers/profile` | ✅ | Get own profile |
| PUT | `/api/workers/profile` | ✅ | Update profile |
| PUT | `/api/workers/availability` | ✅ | Toggle online/offline |
| GET | `/api/workers/jobs` | ✅ | Job history |
| GET | `/api/workers/stats` | ✅ | Stats & ratings |

### Jobs
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/jobs` | ✅ | Post new job |
| GET | `/api/jobs` | ✅ | List open jobs |
| GET | `/api/jobs/my` | ✅ | Customer's own jobs |
| GET | `/api/jobs/:id` | ✅ | Job details |
| POST | `/api/jobs/:id/accept` | ✅ | Worker accepts job |
| POST | `/api/jobs/:id/start` | ✅ | Start job (OTP) |
| POST | `/api/jobs/:id/complete` | ✅ | Complete job (OTP) |
| POST | `/api/jobs/:id/rate` | ✅ | Submit rating |

### SMS/Keypad System
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/sms/webhook` | No | Twilio SMS webhook |
| POST | `/api/sms/setup-worker` | No | Register keypad worker |
| POST | `/api/sms/bulk-send` | No | Send bulk SMS |
| GET | `/api/sms/status` | Admin Key | Check confirmations |

### Utilities
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List all job categories |
| GET | `/api/pricing/:category` | Market price for category |
| GET | `/api/health` | API health check |

---

## Database Schema

```
users              → id, phone, name, role, otp, is_verified
workers            → user_id, category, daily_rate, rank_level, points, lat, lng
jobs               → id, customer_id, title, category, status, is_urgent, lat, lng
job_applications   → job_id, worker_id, status
ratings            → job_id, rater_id, rated_id, score, review
sms_confirmations  → phone_number, name, job_id, confirmed
notifications      → user_id, phone, message, type
```

---

## Worker Ranking System

| Rank | Points Required | Benefit |
|------|----------------|---------|
| 🥉 Bronze | 0+ | Baseline visibility |
| 🥈 Silver | 100+ | 1.2× dispatch priority |
| 🥇 Gold | 300+ | 1.5× dispatch priority |
| 💎 Platinum | 600+ | 2× dispatch priority |

**Points earned per job:**
- Job completed: +10
- 5-star rating: +15
- 4-star rating: +8
- On-time arrival: +5

---

## Revenue Model

1. **3–5% commission** per completed job
2. **₹10–₹20 flat fee** per booking
3. **Urgent job surcharge** (additional service fee)
4. **Worker profile boost** (future – subscription)
5. **Contractor subscription** (bulk hiring dashboard)

---

## Demo Mode

When Twilio credentials are NOT configured:
- OTPs are returned directly in the API response (`demo_otp` field)
- All SMS messages are logged to the console
- This makes it easy to test without a Twilio account

---

## Keypad Phone – Technical Flow

```
Customer posts job
       ↓
Backend finds nearby workers (by GPS)
       ↓
SMS sent: "New Mason job. Reply YES to accept. - KaamMitra"
       ↓
Worker replies YES on keypad phone
       ↓
Twilio webhook → POST /api/sms/webhook
       ↓
Backend identifies worker by phone number
       ↓
Updates sms_confirmations: confirmed=1
       ↓
Assigns job, notifies customer via SMS
       ↓
"Already confirmed" check prevents double-acceptance
```

---

## Project Structure

```
/
├── backend/
│   ├── server.js            # Express main server
│   ├── package.json
│   ├── .env.example         # Environment template
│   ├── db/
│   │   └── setup.js         # SQLite schema + DB helpers
│   ├── routes/
│   │   ├── auth.js          # OTP auth endpoints
│   │   ├── workers.js       # Worker CRUD
│   │   ├── jobs.js          # Job lifecycle
│   │   └── sms.js           # Twilio webhook + keypad system
│   ├── middleware/
│   │   └── auth.js          # JWT middleware
│   └── utils/
│       ├── sms.js           # SMS/OTP utilities (Twilio-ready)
│       ├── ranking.js       # Worker rank calculation
│       └── geo.js           # Haversine distance formula
├── frontend/
│   ├── index.html           # Landing page
│   ├── customer.html        # Customer dashboard
│   ├── worker.html          # Worker dashboard
│   ├── workers.html         # Browse workers
│   └── assets/
│       ├── style.css        # Complete stylesheet
│       └── app.js           # Frontend JS utilities
└── pro/
    └── adarshprecast.html   # Original precast website
```

---

## Final Summary

> *"This project is a hybrid labour marketplace platform designed to connect daily wage workers and employers using both smartphone applications and missed call-based job confirmation. It integrates location-based dispatch, dynamic market pricing, urgent job prioritisation, and worker ranking mechanisms to create an inclusive and scalable employment ecosystem."*

**Built for India 🇮🇳 — where daily wage workers need visibility, trust, and access regardless of the phone they use.**
