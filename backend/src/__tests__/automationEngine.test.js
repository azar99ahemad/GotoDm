const { applyMergeTags, matchRule } = require('../services/automationEngine');

// Mock the DB pool
jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const { pool } = require('../db');

describe('applyMergeTags', () => {
  it('replaces {name} with context name', () => {
    expect(applyMergeTags('Hi {name}!', { name: 'Alice' })).toBe('Hi Alice!');
  });

  it('replaces {username} with context username', () => {
    expect(applyMergeTags('Hey @{username}', { username: 'bob' })).toBe('Hey @bob');
  });

  it('falls back to username when name is missing', () => {
    expect(applyMergeTags('Hi {name}!', { username: 'carol' })).toBe('Hi carol!');
  });

  it('falls back to "there" when both name and username are missing', () => {
    expect(applyMergeTags('Hi {name}!', {})).toBe('Hi there!');
  });

  it('is case-insensitive for tags', () => {
    expect(applyMergeTags('Hi {NAME}!', { name: 'Dave' })).toBe('Hi Dave!');
  });
});

describe('matchRule', () => {
  const automationId = 'automation-uuid-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches a "contains" rule', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'rule-1',
          keyword: 'hello',
          match_type: 'contains',
          action_type: 'send_dm',
          message_text: 'Hi there!',
          priority: 0,
          delay_seconds: 0,
        },
      ],
    });

    const rule = await matchRule(automationId, 'Hello world');
    expect(rule).not.toBeNull();
    expect(rule.id).toBe('rule-1');
  });

  it('matches an "exact" rule', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'rule-2',
          keyword: 'info',
          match_type: 'exact',
          action_type: 'send_dm',
          message_text: 'Here is your info.',
          priority: 0,
          delay_seconds: 0,
        },
      ],
    });

    const rule = await matchRule(automationId, 'info');
    expect(rule).not.toBeNull();
    expect(rule.id).toBe('rule-2');
  });

  it('does not match "exact" when text differs', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'rule-3',
          keyword: 'info',
          match_type: 'exact',
          action_type: 'send_dm',
          message_text: 'Here is your info.',
          priority: 0,
          delay_seconds: 0,
        },
      ],
    });

    const rule = await matchRule(automationId, 'give me info please');
    expect(rule).toBeNull();
  });

  it('matches "starts_with" rule', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'rule-4',
          keyword: 'promo',
          match_type: 'starts_with',
          action_type: 'send_dm',
          message_text: 'Here is your promo!',
          priority: 0,
          delay_seconds: 0,
        },
      ],
    });

    const rule = await matchRule(automationId, 'promo code please');
    expect(rule).not.toBeNull();
  });

  it('matches "regex" rule', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'rule-5',
          keyword: '^(buy|order)\\s+now',
          match_type: 'regex',
          action_type: 'send_dm',
          message_text: 'Thanks for your interest!',
          priority: 0,
          delay_seconds: 0,
        },
      ],
    });

    const rule = await matchRule(automationId, 'buy now');
    expect(rule).not.toBeNull();
  });

  it('returns catch-all rule (null keyword) when no keyword matches', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'rule-fallback',
          keyword: null,
          match_type: 'contains',
          action_type: 'send_dm',
          message_text: 'Thanks for reaching out!',
          priority: 0,
          delay_seconds: 0,
        },
      ],
    });

    const rule = await matchRule(automationId, 'random text');
    expect(rule).not.toBeNull();
    expect(rule.id).toBe('rule-fallback');
  });

  it('returns null when no rules match and no fallback', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'rule-6',
          keyword: 'specific',
          match_type: 'exact',
          action_type: 'send_dm',
          message_text: 'Only for specific.',
          priority: 0,
          delay_seconds: 0,
        },
      ],
    });

    const rule = await matchRule(automationId, 'something else entirely');
    expect(rule).toBeNull();
  });
});
