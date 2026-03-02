const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
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

// GET /api/instagram/connect  →  Redirect to Meta OAuth
router.get('/connect', authenticate, (req, res) => {
  const state = Buffer.from(
    JSON.stringify({ userId: req.user.id, csrf: crypto.randomBytes(16).toString('hex') }),
  ).toString('base64url');

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

  let stateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch {
    return res.redirect(`${process.env.FRONTEND_URL}/connect?error=invalid_state`);
  }

  const { userId } = stateData;

  try {
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
