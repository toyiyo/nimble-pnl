#!/usr/bin/env node
/**
 * pr-triage — enforce that every PR review finding carries a visible verdict reply.
 *
 * Pure logic (VERDICTS, composeReply, parseVerdict, classifyThreads, renderSummary)
 * performs no I/O so it can be unit-tested. All GitHub access lives in the CLI verbs.
 *
 * See docs/superpowers/specs/2026-07-27-pr-comment-response-gate-design.md
 */

/** The three verdicts a finding may receive. Keys are the machine form. */
export const VERDICTS = Object.freeze({
  agreed: Object.freeze({
    key: 'agreed',
    display: '✅ Agreed',
    marker: '<!-- pr-triage: agreed -->',
  }),
  'pushed-back': Object.freeze({
    key: 'pushed-back',
    display: '↩️ Pushed back',
    marker: '<!-- pr-triage: pushed-back -->',
  }),
  ignored: Object.freeze({
    key: 'ignored',
    display: '⏭️ Ignored',
    marker: '<!-- pr-triage: ignored -->',
  }),
});

/** A rationale shorter than this explains nothing to a future reader. */
const MIN_RATIONALE_LENGTH = 10;

/**
 * Build the body of a threaded reply.
 * @param {{verdict: string, rationale: string, commit?: string}} input
 * @returns {string} the markdown body to post
 */
export function composeReply({ verdict, rationale, commit } = {}) {
  const spec = VERDICTS[verdict];
  if (!spec) {
    throw new Error(
      `Unknown verdict "${verdict}". Expected one of: ${Object.keys(VERDICTS).join(', ')}`,
    );
  }

  const text = (rationale ?? '').trim();
  if (text.length < MIN_RATIONALE_LENGTH) {
    throw new Error(
      `A rationale of at least ${MIN_RATIONALE_LENGTH} characters is required — ` +
        'the point of the reply is to tell a future reader why.',
    );
  }

  if (verdict === 'agreed' && !(commit ?? '').trim()) {
    throw new Error('An "agreed" reply must cite the commit that fixed the finding.');
  }

  const suffix = verdict === 'agreed' ? ` Fixed in \`${commit.trim()}\`.` : '';
  return `${spec.marker}\n**${spec.display}** — ${text}${suffix}`;
}

/**
 * Hand-typed aliases, so a human replying in the GitHub UI is never blocked
 * by having to remember the HTML marker. Longest first: "pushed back" must be
 * tried before any shorter prefix of it could match.
 */
const VERDICT_ALIASES = [
  ['pushed back', 'pushed-back'],
  ['pushed-back', 'pushed-back'],
  ['declined', 'pushed-back'],
  ['agreed', 'agreed'],
  ['ignored', 'ignored'],
];

/**
 * Extract a verdict and its rationale from a reply body.
 * @param {string} body
 * @returns {{verdict: string, rationale: string} | null} null when the body carries no verdict
 */
export function parseVerdict(body) {
  if (typeof body !== 'string' || !body.trim()) return null;

  // Preferred form: the machine marker, wherever it appears in the body.
  for (const spec of Object.values(VERDICTS)) {
    if (body.includes(spec.marker)) {
      const rationale = stripToRationale(body.replace(spec.marker, ''), spec.display);
      return rationale ? { verdict: spec.key, rationale } : null;
    }
  }

  // Fallback: a hand-typed reply whose FIRST line opens with a verdict word.
  // Anchoring to the start is what stops "everyone agreed: ..." from matching.
  const firstLine = body.trim().split('\n')[0].trim();
  const plain = firstLine.replace(/\*\*/g, '').replace(/[✅↩️⏭️]/gu, '').trim();
  for (const [alias, key] of VERDICT_ALIASES) {
    const pattern = new RegExp(`^${alias}\\s*(?::|—|–|-)\\s*(.+)$`, 'iu');
    const match = plain.match(pattern);
    if (match) {
      const rationale = match[1].trim();
      return rationale.length >= MIN_RATIONALE_LENGTH ? { verdict: key, rationale } : null;
    }
  }

  return null;
}

/** Pull the human rationale out of a marker-form body. */
function stripToRationale(body, display) {
  return body
    .replace(/\*\*/g, '')
    .replace(display, '')
    .replace(/^[\s—–-]+/u, '')
    .trim();
}
