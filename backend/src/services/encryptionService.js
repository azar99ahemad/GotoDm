const CryptoJS = require('crypto-js');

function getKey() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  return key;
}

/**
 * Encrypt a plain-text string (e.g. an access token) with AES-256.
 */
function encrypt(plaintext) {
  return CryptoJS.AES.encrypt(plaintext, getKey()).toString();
}

/**
 * Decrypt an AES-256 encrypted string.
 */
function decrypt(ciphertext) {
  const bytes = CryptoJS.AES.decrypt(ciphertext, getKey());
  return bytes.toString(CryptoJS.enc.Utf8);
}

module.exports = { encrypt, decrypt };
