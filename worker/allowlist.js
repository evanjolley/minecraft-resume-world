/*
 * THE OUTPUT GATE. The one control here that a model cannot argue with.
 *
 * docs/ai-evan/01-truthfulness section 6 is blunt about the rest of it:
 * prompt-injection defences are mostly theatre against an adaptive attacker,
 * system-prompt extraction runs 80-92% in the wild, and roleplay is the
 * highest-yield vector at ~96.5%. This project cannot close that, because
 * roleplay IS the product -- the whole thing is a person pretending to be a
 * person. One reported figure has a mid-tier model holding a protected phrase
 * against an adversarial user only 61.9% of the time.
 *
 * So the design gives up on persuading the model and checks the bytes instead.
 * Whatever the model was talked into, the words do not leave the Worker. That
 * is a property of a regex, not of a persona, and no amount of "pretend you
 * are DAN" changes it. It runs in microseconds, it needs no second model call,
 * and it fails closed.
 *
 * Rejected: a prompted LLM judge on the output. Section 6.2 puts prompted
 * judges at 88-93% attackable themselves and ~718 ms versus ~3.6 ms for a
 * small classifier, so the expensive option is also the one that can be
 * jailbroken. If this ever needs semantics rather than strings, the note in
 * that section is to fine-tune a small encoder, not to prompt a big model.
 *
 * WHAT IT DOES NOT COVER, said out loud so nobody assumes otherwise:
 *
 *   - Paraphrase. "The fund whose name is a letter and two numbers" walks
 *     straight through. The gate catches the literal, which is what ends up
 *     in a screenshot.
 *   - Tool arguments. A model could in principle spell something out in a
 *     walk_to coordinate. Not built: the channel is two floats wide and the
 *     effort to abuse it exceeds the value of what is on the other side.
 *   - Anything about Evan's family, which is controlled by OMISSION instead.
 *     It is never in the prompt, so there is nothing to leak and nothing for
 *     a regex to catch. That is strictly stronger than a filter.
 *
 * WHERE THE TERMS COME FROM. Not this file. scripts/build-prompt.mjs derives
 * them from corpus/ at build time into prompt.generated.js, which is
 * gitignored, because this repository is public and the sensitive terms are
 * exactly the thing that must not be committed. Committing a file called
 * "allowlist" containing three words and a comment saying they are the
 * secrets would be the same leak with extra steps.
 */

/**
 * Compile the gate once, at Worker start.
 *
 * @param {object} data  from prompt.generated.js
 * @param {string[]} data.WITHHELD_TERMS  proper nouns, derived from corpus/
 * @param {string[]} data.COMP_PATTERNS   regex sources, generic English
 * @param {string} data.GATE_LINE         what he says instead
 */
export function createGate({ WITHHELD_TERMS = [], COMP_PATTERNS = [], GATE_LINE = '' }) {
  /*
   * Terms are matched loosely on purpose: case-insensitive, and tolerant of
   * spaces, dots and hyphens shoved between the characters. "a 1 6 z" and
   * "a.1.6.z" are the first two things anyone tries, and a model asked to
   * "spell it with spaces" will comply cheerfully.
   *
   * Word boundaries at each end so a term that happens to be a substring of
   * an ordinary word does not fire. \b is wrong at a non-word edge, so this
   * uses lookaround on word characters instead, which behaves at both ends.
   */
  const loose = (term) => term
    .split('')
    .map((ch) => (/[A-Za-z0-9]/.test(ch) ? escapeRe(ch) : '\\W'))
    .join('[\\s.\\-_*]{0,2}')

  const termRes = WITHHELD_TERMS.map((t) => ({
    kind: 'withheld',
    re: new RegExp(`(?<![A-Za-z0-9])${loose(t)}(?![A-Za-z0-9])`, 'i'),
  }))
  const compRes = COMP_PATTERNS.map((p) => ({ kind: 'compensation', re: new RegExp(p, 'i') }))
  const all = [...termRes, ...compRes]

  return {
    /** @returns {null | { kind: string }} null means clean. */
    check(text) {
      const s = String(text ?? '')
      for (const { kind, re } of all) if (re.test(s)) return { kind }
      return null
    },

    /**
     * Screen one assistant turn on its way out of the Worker.
     *
     * BLOCKS THE WHOLE TURN, not the offending sentence. Deleting a sentence
     * leaves a reply that reads as though something was removed, which tells
     * the asker they found the edge and is an invitation to push. A flat
     * in-character decline tells them nothing.
     *
     * It also drops any tool calls in that turn. A turn that had to be
     * blocked is a turn whose judgment is not trusted, and letting its side
     * effects through anyway would be trusting it selectively.
     *
     * @param {Array} content  Anthropic content blocks
     */
    screen(content) {
      const blocks = Array.isArray(content) ? content : []
      for (const b of blocks) {
        if (b.type !== 'text') continue
        const hit = this.check(b.text)
        if (hit) {
          return {
            blocked: hit.kind,
            content: [{ type: 'text', text: GATE_LINE }],
            stop_reason: 'end_turn',
          }
        }
      }
      return { blocked: null, content: blocks }
    },
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
