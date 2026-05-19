const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { getRedisClient } = require('../config/redis');
const {
  getOAuthUrl,
  exchangeCodeForToken,
  fetchUserPages,
  fetchInstagramAccount,
  saveInstagramAccount,
} = require('../services/instagramService');
const { pool } = require('../db');
const logger = require('../config/logger');

const router = express.Router();
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function signStatePayload(payload) {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeOAuthState(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = signStatePayload(payload);
  return `${payload}.${sig}`;
}

function decodeAndVerifyOAuthState(state) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return null;
  const [payload, sig] = state.split('.');
  const expectedSig = signStatePayload(payload);
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
    if (!ok) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// GET /api/instagram/connect  →  Redirect to Meta OAuth
router.get('/connect', authenticate, async (req, res) => {
  const csrf = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const statePayload = {
    nonce,
    userId: req.user.id,
    csrf,
    iat: Date.now(),
  };

  const state = encodeOAuthState(statePayload);
  const redis = getRedisClient();
  try {
    await redis.set(
      `oauth_state:${nonce}`,
      JSON.stringify({ userId: req.user.id, csrf }),
      'EX',
      OAUTH_STATE_TTL_SECONDS,
    );
  } catch (err) {
    logger.error('Failed to persist OAuth state', { error: err.message });
    return res.status(500).json({ error: 'Failed to initialize OAuth flow' });
  }

  const url = getOAuthUrl(state);
  res.json({ url });
});

// GET /api/instagram/callback  →  Handle Meta OAuth redirect
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.warn('Instagram OAuth error', { error });
    return res.redirect(
      `${process.env.FRONTEND_URL}/connect?error=${encodeURIComponent(error)}`,
    );
  }

  const stateData = decodeAndVerifyOAuthState(state);
  if (!stateData) {
    return res.redirect(`${process.env.FRONTEND_URL}/connect?error=invalid_state`);
  }

  const { userId, csrf, nonce } = stateData;

  try {
    const redis = getRedisClient();
    const stored = await redis.get(`oauth_state:${nonce}`);
    if (!stored) {
      return res.redirect(`${process.env.FRONTEND_URL}/connect?error=invalid_state`);
    }
    const storedState = JSON.parse(stored);
    if (String(storedState.userId) !== String(userId) || storedState.csrf !== csrf) {
      return res.redirect(`${process.env.FRONTEND_URL}/connect?error=invalid_state`);
    }
    await redis.del(`oauth_state:${nonce}`);

    // 1. Exchange code → long-lived token
    const tokenData = await exchangeCodeForToken(code);
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    // 2. Fetch user's Facebook pages
    const pages = await fetchUserPages(tokenData.access_token);
    if (pages.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/connect?error=no_pages`);
    }

    // 3. For each page, find linked Instagram Business Account
    let igAccount = null;
    let linkedPage = null;
    for (const page of pages) {
      const ig = await fetchInstagramAccount(page.access_token, page.id).catch(() => null);
      if (ig) {
        igAccount = ig;
        linkedPage = page;
        break;
      }
    }

    if (!igAccount) {
      return res.redirect(`${process.env.FRONTEND_URL}/connect?error=no_instagram_account`);
    }

    // 4. Save to DB
    const account = await saveInstagramAccount(userId, {
      igAccount,
      page: linkedPage,
      longLivedToken: tokenData.access_token,
      expiresAt,
    });

    logger.info('Instagram account connected', { userId, instagramUserId: igAccount.id });
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?connected=1`);
  } catch (err) {
    logger.error('Instagram OAuth callback error', { error: err.message });
    res.redirect(`${process.env.FRONTEND_URL}/connect?error=server_error`);
  }
});

// GET /api/instagram/accounts  →  List connected accounts
router.get('/accounts', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, instagram_user_id, username, name, profile_picture_url,
            token_expires_at, is_active, webhook_verified, created_at
     FROM instagram_accounts
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.user.id],
  );
  res.json(rows);
});

// DELETE /api/instagram/accounts/:accountId  →  Disconnect account
router.delete('/accounts/:accountId', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM instagram_accounts WHERE id = $1 AND user_id = $2 RETURNING id',
    [req.params.accountId, req.user.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Account not found' });
  res.json({ message: 'Account disconnected' });
});

module.exports = router;
