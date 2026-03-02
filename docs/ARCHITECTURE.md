# GotoDM – System Architecture

## High-Level ASCII Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERNET                                     │
└────────────┬──────────────────────────────┬────────────────────────┘
             │                              │
    ┌────────▼────────┐           ┌─────────▼─────────┐
    │  Next.js SPA    │           │  Meta / Instagram  │
    │  (Frontend)     │           │  Graph API v19     │
    └────────┬────────┘           └─────────┬─────────┘
             │ REST / JWT                   │ Webhooks + API calls
    ┌────────▼────────────────────────────────────────────────┐
    │                  Express API Server                       │
    │  /api/auth  /api/instagram  /api/webhook                  │
    │  /api/automations  /api/billing  /api/analytics           │
    └───┬─────────────────┬──────────────────┬────────────────┘
        │                 │                  │
   ┌────▼────┐     ┌──────▼──────┐    ┌─────▼──────┐
   │PostgreSQL│     │ Redis + BullMQ│   │  Stripe API│
   │(Primary  │     │   Queues     │   └────────────┘
   │ data)    │     │  DM workers  │
   └──────────┘     └─────────────┘
```

## Webhook Flow

```
Meta Server → POST /api/webhook
      │
      ▼ (< 200ms) Verify HMAC-SHA256 signature
      │
      ▼  Respond 200 OK immediately
      │
      ▼ For each event (async, non-blocking):
         │
         ├── DM event → evaluate automation rules
         │                └── enqueueDM() → BullMQ 'dm-send' queue
         │
         └── Comment event → evaluate rules
                              └── enqueueCommentReply() → 'comment-reply' queue

BullMQ Worker (separate process or goroutine):
  'dm-send' job → sendDMWithRetry() → POST /PAGE_ID/messages (Graph API)
                                    → UPDATE message_logs SET status='sent'
                                    → UPDATE usage_limits SET dm_sent = dm_sent + 1
```

## Queue Processing Flow

```
Webhook Handler
    │ enqueueDM({ logId, recipientIgId, messageText, delaySeconds })
    ▼
Redis Queue (BullMQ)
    │ Job delayed by delaySeconds (human-like timing)
    ▼
messageWorker (concurrency=5)
    │ Attempt 1
    ├─ Success → update log status = 'sent', increment usage
    │
    ├─ Retryable error (rate limit 4/17/32/613 or 5xx)
    │   └── Exponential backoff (1s, 2s, 4s … max 30s)
    │       └── Attempt 2 … Attempt 3
    │
    └─ Non-retryable → update log status = 'failed'
```

## Multi-Tenant Handling

Every database table includes `user_id` as a foreign key.
All API routes are protected by `authenticate` middleware that:
1. Verifies the JWT
2. Confirms the user still exists in the DB
3. Attaches `req.user = { id, email, role }`

All queries are scoped to `req.user.id`, making it impossible for one tenant to access another's data.

---

## Database Schema Summary

| Table | Purpose |
|---|---|
| `users` | SaaS user accounts |
| `subscriptions` | Stripe customer + plan info |
| `usage_limits` | Per-period DM counter + plan limit |
| `instagram_accounts` | Connected IG Business accounts (tokens AES-256 encrypted) |
| `automations` | Rule containers (trigger type + account) |
| `automation_rules` | Keyword → action mappings |
| `message_logs` | Full audit trail of every DM/comment reply |
| `refresh_tokens` | Rotating JWT refresh token store |

---

## Instagram OAuth Flow (Step-by-Step)

1. **User clicks "Connect Instagram"** → `GET /api/instagram/connect`
2. **Backend** builds Meta OAuth URL with scopes and a signed `state` param, returns it to frontend
3. **Frontend** redirects user to `https://www.facebook.com/dialog/oauth?...`
4. **User** grants permissions on Meta
5. **Meta** redirects to `GET /api/instagram/callback?code=...&state=...`
6. **Backend** exchanges `code` for a short-lived token, then for a 60-day long-lived token
7. **Backend** fetches user's Facebook Pages → finds linked Instagram Business Account
8. **Backend** encrypts tokens (AES-256) and upserts `instagram_accounts` row
9. **Backend** redirects user to `FRONTEND_URL/dashboard?connected=1`

### Required Permissions
- `instagram_basic`
- `instagram_manage_messages`
- `instagram_manage_comments`
- `pages_show_list`
- `pages_messaging`
- `pages_read_engagement`

### Token Refresh Strategy
- Long-lived tokens expire in ~60 days
- Schedule a daily cron to check `token_expires_at < NOW() + INTERVAL '7 days'`
- Call `GET /oauth/access_token?grant_type=fb_exchange_token` to refresh
- Update `access_token_enc` and `token_expires_at`

---

## Automation Engine – Rule Matching

```
evaluate({ instagramAccountId, triggerType, inboundText, context })
  │
  ▼ findActiveAutomations(instagramAccountId, triggerType)
  │
  ▼ For each automation:
      matchRule(automation.id, inboundText)
        │
        ▼ Fetch rules ORDER BY keyword IS NULL ASC, priority DESC
          │
          ├── match_type = 'contains'    → text.includes(keyword)
          ├── match_type = 'exact'       → text === keyword
          ├── match_type = 'starts_with' → text.startsWith(keyword)
          ├── match_type = 'regex'       → new RegExp(keyword).test(text)
          └── keyword = NULL             → catch-all fallback (always matches)
```

---

## Message Sending Safety Guardrails

1. **24-hour window**: Only reply to users who have messaged first (RESPONSE type). The webhook only fires for inbound messages, so the 24-hour window is naturally respected.
2. **No cold messaging**: All DMs are triggered by an inbound event (comment or DM). Never initiate first contact.
3. **Rate limiting**: Express rate limiter + BullMQ concurrency cap (5 concurrent jobs)
4. **Usage limits**: `checkUsageLimit` middleware blocks sends when monthly quota is hit
5. **Retry safety**: Non-retryable errors (e.g. 400 Bad Request) are not retried

---

## Billing – Plan-Based Limits

| Plan    | DMs/mo  | Price  |
|---------|---------|--------|
| Free    | 500     | $0     |
| Starter | 2,000   | $29    |
| Pro     | 10,000  | $79    |
| Agency  | 50,000  | $199   |

Stripe webhook events keep `subscriptions` and `usage_limits` in sync automatically.

---

## Security

| Concern | Mitigation |
|---|---|
| Instagram tokens | AES-256 encrypted at rest (`TOKEN_ENCRYPTION_KEY`) |
| JWT access tokens | Short-lived (15 min); rotated refresh tokens (7 days) |
| Webhook authenticity | HMAC-SHA256 signature verification (Meta + Stripe) |
| API abuse | express-rate-limit per user/IP |
| Over-spending | `checkUsageLimit` middleware |
| SQL injection | Parameterized queries throughout (no raw string interpolation) |
| Secrets in code | All secrets via environment variables; `.env` in `.gitignore` |

---

## Meta App Review Checklist

- [ ] App type: Business (not Consumer)
- [ ] Privacy Policy URL configured
- [ ] App icon + description filled in
- [ ] Demo video showing the exact OAuth flow and DM being sent/received
- [ ] Only request permissions you actively use
- [ ] `instagram_manage_messages` — explain the exact use case
- [ ] `instagram_manage_comments` — explain keyword-to-DM flow
- [ ] Test with a real Business account (not personal)
- [ ] All API calls use HTTPS
- [ ] Webhook endpoint responds < 5 seconds
- [ ] Webhook uses HTTPS with a valid TLS certificate

### Common Rejection Reasons
1. Requesting unnecessary permissions
2. Demo video doesn't show the feature clearly
3. Privacy Policy doesn't mention Instagram data usage
4. App uses scraping instead of official API
5. Missing business verification for the Facebook Page

---

## Development Roadmap

### Week 1 – Foundation
- [ ] Set up Docker Compose (PostgreSQL + Redis)
- [ ] Run DB migrations
- [ ] Implement auth routes (register/login/refresh)
- [ ] Test with Postman/curl

### Week 2 – Instagram Integration
- [ ] Register Meta Developer App, configure OAuth redirect
- [ ] Test OAuth flow end-to-end
- [ ] Set up webhook URL (ngrok for local dev)
- [ ] Verify webhook handshake

### Week 3 – Automation Engine
- [ ] Create automations + rules via API
- [ ] Send test DM via Graph API
- [ ] Test webhook → queue → worker pipeline

### Week 4 – Frontend MVP
- [ ] Login / Register pages
- [ ] Dashboard with stats
- [ ] Connect Instagram page
- [ ] Automations list + rule builder

### Week 5 – Billing
- [ ] Set up Stripe products/prices
- [ ] Checkout flow
- [ ] Webhook sync
- [ ] Usage limit enforcement

### Week 6 – Hardening
- [ ] Token refresh cron job
- [ ] Error monitoring (Sentry)
- [ ] Load testing
- [ ] Meta App Review submission

### Testing Strategy
- Unit tests: automation engine rule matching, encryption service
- Integration tests: auth routes (mock DB), webhook signature verification
- E2E (manual): OAuth flow, DM send, webhook trigger
