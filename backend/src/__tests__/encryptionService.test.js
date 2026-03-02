const { encrypt, decrypt } = require('../services/encryptionService');

// Provide a test key before tests run
beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = 'test-secret-key-32chars-padded!!';
});

describe('encryptionService', () => {
  it('encrypts and decrypts a string round-trip', () => {
    const original = 'EAABsbCS1234567890abcdef';
    const cipher   = encrypt(original);
    expect(cipher).not.toBe(original);
    const plain = decrypt(cipher);
    expect(plain).toBe(original);
  });

  it('produces different cipher text for repeated encryptions', () => {
    const original = 'same-token';
    const c1 = encrypt(original);
    const c2 = encrypt(original);
    // AES with a random IV should not produce the same ciphertext
    expect(c1).not.toBe(c2);
  });

  it('throws when TOKEN_ENCRYPTION_KEY is missing', () => {
    const savedKey = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY = savedKey;
  });
});
