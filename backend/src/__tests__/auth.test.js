/**
 * Integration tests for the Auth routes.
 * These mock the database so no real PG connection is needed.
 */
const request = require('supertest');
const bcrypt  = require('bcryptjs');

// Mock DB before importing app
jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  runMigrations: jest.fn().mockResolvedValue(undefined),
}));

// Mock workers so they don't try to connect to Redis
jest.mock('../queues/workers/messageWorker', () => ({
  startDMWorker:      jest.fn(),
  startCommentWorker: jest.fn(),
}));

// Provide required env vars
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.TOKEN_ENCRYPTION_KEY = 'test-enc-key-32chars-padded!!!!';
process.env.FRONTEND_URL = 'http://localhost:3000';

const app = require('../index');
const { pool } = require('../db');

describe('POST /api/auth/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 422 for invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(422);
  });

  it('returns 422 for short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'short' });
    expect(res.status).toBe(422);
  });

  it('returns 409 when email is already taken', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] }); // SELECT existing

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'taken@example.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('creates a user and returns tokens', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })          // no existing user
      .mockResolvedValueOnce({ rows: [{ id: 'new-user-uuid', email: 'new@example.com', full_name: null, role: 'owner' }] }) // INSERT user
      .mockResolvedValueOnce({ rows: [] })          // INSERT subscription
      .mockResolvedValueOnce({ rows: [] })          // INSERT usage_limits
      .mockResolvedValueOnce({ rows: [] });         // INSERT refresh_token

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe('new@example.com');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 for unknown email', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unknown@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    const hash = await bcrypt.hash('correctpassword', 10);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'u@example.com', password_hash: hash, full_name: null, role: 'owner' }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'u@example.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('returns tokens for valid credentials', async () => {
    const hash = await bcrypt.hash('correctpassword', 10);
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'u1', email: 'u@example.com', password_hash: hash, full_name: 'User', role: 'owner' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // INSERT refresh_token

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'u@example.com', password: 'correctpassword' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });
});
