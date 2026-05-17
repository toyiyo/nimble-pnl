'use strict';

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._\-+/=]+/g;
const RESTAURANT_ID_PARAM = /restaurant_id=([^&\s"']+)/gi;
const MAX_LEN = 2000;

function sanitize(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  out = out.replace(RESTAURANT_ID_PARAM, 'restaurant_id=<redacted>');
  out = out.replace(JWT, '<redacted-token>');
  out = out.replace(BEARER, '<redacted-token>');
  out = out.replace(EMAIL, '<redacted-email>');
  out = out.replace(UUID, '<redacted-uuid>');
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '… [truncated]';
  return out;
}

module.exports = { sanitize };
