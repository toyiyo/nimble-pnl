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
