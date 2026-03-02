# GotoDM – Instagram DM Automation SaaS

Production-ready Instagram DM Automation SaaS built on the **official Instagram Graph API**.

- **Multi-tenant** – every user's data is fully isolated
- **Compliant** – only official OAuth, no scraping, respects 24-hour window
- **Scalable** – Redis + BullMQ for async message processing
- **Secure** – AES-256 token encryption, JWT rotation, HMAC webhook verification

## Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Frontend   | Next.js 14 + Tailwind CSS           |
| Backend    | Node.js + Express                   |
| Database   | PostgreSQL                          |
| Queue      | Redis + BullMQ                      |
| Auth       | JWT (access + rotating refresh)     |
| Payments   | Stripe Subscriptions                |
| Deploy     | Docker Compose                      |

## Features

- Instagram OAuth connection flow (Business & Creator accounts)
- Comment → DM automation (keyword-based, with regex support)
- Auto-reply to first inbound DM
- Keyword-based DM replies with merge tags (`{name}`, `{username}`)
- Visual rule builder UI
- Rate limiting and human-like send delays
- Message usage tracking per billing period
- Stripe subscription integration (Free / Starter / Pro / Agency)
- Analytics dashboard with daily charts

## Quick Start

\`\`\`bash
# 1. Clone & configure
cp .env.example .env
# Fill in .env with your Meta App credentials, Stripe keys, etc.

# 2. Start all services
docker compose up -d

# 3. The API is available at http://localhost:3001
#    The frontend is available at http://localhost:3000
\`\`\`

## Development (without Docker)

\`\`\`bash
# Start PostgreSQL and Redis (via Docker or locally)

# Backend
cd backend
npm install
npm run migrate   # runs SQL migrations
npm run dev       # nodemon server on :3001

# Frontend
cd frontend
npm install
npm run dev       # Next.js on :3000
\`\`\`

## Running Tests

\`\`\`bash
cd backend
npm test
\`\`\`

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for:
- System architecture diagram
- Webhook flow
- Queue processing flow
- Database schema
- Instagram OAuth step-by-step
- Security overview
- Meta App Review checklist
- Development roadmap

## Environment Variables

See [.env.example](.env.example) for all required variables.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Refresh JWT |
| GET  | `/api/instagram/connect` | Start OAuth flow |
| GET  | `/api/instagram/callback` | OAuth callback |
| GET  | `/api/instagram/accounts` | List connected accounts |
| GET  | `/api/automations` | List automations |
| POST | `/api/automations` | Create automation |
| GET  | `/api/automations/:id/rules` | List rules |
| POST | `/api/automations/:id/rules` | Add rule |
| GET  | `/api/webhook` | Meta webhook verification |
| POST | `/api/webhook` | Meta webhook events |
| GET  | `/api/analytics/overview` | Dashboard stats |
| GET  | `/api/analytics/daily` | Daily DM volume |
| POST | `/api/billing/checkout` | Create Stripe checkout |
| POST | `/api/billing/portal` | Stripe billing portal |
| POST | `/api/billing/webhook` | Stripe webhook |

## License

MIT
