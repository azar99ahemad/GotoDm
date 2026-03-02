const axios = require('axios');
const { pool } = require('../db');
const { encrypt, decrypt } = require('./encryptionService');
const logger = require('../config/logger');

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Build the Instagram OAuth authorization URL.
 */
function getOAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    scope: [
      'instagram_basic',
      'instagram_manage_messages',
      'instagram_manage_comments',
      'instagram_content_publish',
      'pages_show_list',
      'pages_messaging',
      'pages_read_engagement',
    ].join(','),
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/dialog/oauth?${params.toString()}`;
}

/**
 * Exchange a short-lived authorization code for a long-lived token.
 * Returns { access_token, token_type, expires_in }
 */
async function exchangeCodeForToken(code) {
  const { data } = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
    params: {
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      code,
    },
  });

  // Exchange short-lived for long-lived (60-day) token
  const { data: longLived } = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      fb_exchange_token: data.access_token,
    },
  });

  return longLived;
}

/**
 * Fetch the connected Instagram Business Account linked to the user's Facebook page.
 */
async function fetchInstagramAccount(pageAccessToken, pageId) {
  const { data } = await axios.get(`${GRAPH_API_BASE}/${pageId}`, {
    params: {
      fields: 'instagram_business_account{id,username,name,profile_picture_url}',
      access_token: pageAccessToken,
    },
  });
  return data.instagram_business_account || null;
}

/**
 * Fetch all Facebook Pages the user manages and find the page access token.
 */
async function fetchUserPages(userAccessToken) {
  const { data } = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
    params: { access_token: userAccessToken },
  });
  return data.data || [];
}

/**
 * Refresh a nearly-expired long-lived token (call ~7 days before expiry).
 */
async function refreshLongLivedToken(longLivedToken) {
  const { data } = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      fb_exchange_token: longLivedToken,
    },
  });
  return data;
}

/**
 * Upsert an Instagram account record for a user after OAuth callback.
 */
async function saveInstagramAccount(userId, { igAccount, page, longLivedToken, expiresAt }) {
  const encryptedToken = encrypt(longLivedToken);
  const encryptedPageToken = page?.access_token ? encrypt(page.access_token) : null;

  const { rows } = await pool.query(
    `INSERT INTO instagram_accounts
       (user_id, instagram_user_id, username, name, profile_picture_url,
        access_token_enc, token_expires_at, page_id, page_access_token_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, instagram_user_id)
     DO UPDATE SET
       username             = EXCLUDED.username,
       name                 = EXCLUDED.name,
       profile_picture_url  = EXCLUDED.profile_picture_url,
       access_token_enc     = EXCLUDED.access_token_enc,
       token_expires_at     = EXCLUDED.token_expires_at,
       page_id              = EXCLUDED.page_id,
       page_access_token_enc = EXCLUDED.page_access_token_enc,
       updated_at           = NOW()
     RETURNING id, instagram_user_id, username`,
    [
      userId,
      igAccount.id,
      igAccount.username,
      igAccount.name,
      igAccount.profile_picture_url,
      encryptedToken,
      expiresAt,
      page?.id || null,
      encryptedPageToken,
    ],
  );
  return rows[0];
}

/**
 * Send a direct message via the Instagram Graph API.
 * Requires the instagram_manage_messages permission.
 */
async function sendDM({ recipientIgId, messageText, igAccountId }) {
  const { rows } = await pool.query(
    'SELECT page_id, page_access_token_enc FROM instagram_accounts WHERE id = $1',
    [igAccountId],
  );
  if (rows.length === 0) throw new Error('Instagram account not found');

  const { page_id, page_access_token_enc } = rows[0];
  const pageToken = decrypt(page_access_token_enc);

  const { data } = await axios.post(
    `${GRAPH_API_BASE}/${page_id}/messages`,
    {
      recipient: { id: recipientIgId },
      message: { text: messageText },
      messaging_type: 'RESPONSE',
    },
    { params: { access_token: pageToken } },
  );

  return data;
}

/**
 * Reply to a comment on behalf of an Instagram Business Account.
 */
async function replyToComment({ commentId, messageText, igAccountId }) {
  const { rows } = await pool.query(
    'SELECT instagram_user_id, access_token_enc FROM instagram_accounts WHERE id = $1',
    [igAccountId],
  );
  if (rows.length === 0) throw new Error('Instagram account not found');

  const token = decrypt(rows[0].access_token_enc);

  const { data } = await axios.post(
    `${GRAPH_API_BASE}/${commentId}/replies`,
    { message: messageText },
    { params: { access_token: token } },
  );

  return data;
}

module.exports = {
  getOAuthUrl,
  exchangeCodeForToken,
  fetchInstagramAccount,
  fetchUserPages,
  refreshLongLivedToken,
  saveInstagramAccount,
  sendDM,
  replyToComment,
};
