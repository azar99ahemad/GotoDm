const { pool } = require('../db');
const logger = require('../config/logger');

/**
 * Replace merge tags in a message template with real values.
 * Supported tags: {name}, {username}
 */
function applyMergeTags(text, context = {}) {
  return text
    .replace(/\{name\}/gi, context.name || context.username || 'there')
    .replace(/\{username\}/gi, context.username || '');
}

/**
 * Find the best matching automation rule for a given trigger.
 *
 * @param {string} automationId - UUID of the automation
 * @param {string|null} inboundText - Text from the inbound event (comment or DM)
 * @returns {object|null} The matching rule row, or null
 */
async function matchRule(automationId, inboundText) {
  const { rows: rules } = await pool.query(
    `SELECT * FROM automation_rules
     WHERE automation_id = $1
     ORDER BY keyword IS NULL ASC, priority DESC`,
    [automationId],
  );

  const text = (inboundText || '').toLowerCase().trim();

  for (const rule of rules) {
    // Catch-all / fallback rule (NULL keyword)
    if (rule.keyword === null || rule.keyword === '') {
      return rule;
    }

    const kw = rule.keyword.toLowerCase().trim();
    let matched = false;

    switch (rule.match_type) {
      case 'exact':
        matched = text === kw;
        break;
      case 'starts_with':
        matched = text.startsWith(kw);
        break;
      case 'regex':
        try {
          matched = new RegExp(kw, 'i').test(text);
        } catch {
          logger.warn('Invalid regex in automation rule', { ruleId: rule.id, keyword: rule.keyword });
        }
        break;
      case 'contains':
      default:
        matched = text.includes(kw);
        break;
    }

    if (matched) return rule;
  }

  return null;
}

/**
 * Find all active automations for an Instagram account that match a given trigger type.
 */
async function findActiveAutomations(instagramAccountId, triggerType) {
  const { rows } = await pool.query(
    `SELECT * FROM automations
     WHERE instagram_account_id = $1
       AND trigger_type = $2
       AND is_active = TRUE`,
    [instagramAccountId, triggerType],
  );
  return rows;
}

/**
 * Core rule evaluation: given an event, find and return the best matching action.
 *
 * @param {object} params
 * @param {string} params.instagramAccountId
 * @param {string} params.triggerType - 'comment_keyword' | 'dm_keyword' | 'first_dm'
 * @param {string} params.inboundText
 * @param {object} params.context - merge tag context { name, username }
 * @returns {{ rule, automation, messageText }|null}
 */
async function evaluate({ instagramAccountId, triggerType, inboundText, context = {} }) {
  const automations = await findActiveAutomations(instagramAccountId, triggerType);

  for (const automation of automations) {
    const rule = await matchRule(automation.id, inboundText);
    if (rule) {
      const messageText = rule.message_text
        ? applyMergeTags(rule.message_text, context)
        : null;
      return { rule, automation, messageText };
    }
  }

  return null;
}

module.exports = { evaluate, matchRule, applyMergeTags, findActiveAutomations };
