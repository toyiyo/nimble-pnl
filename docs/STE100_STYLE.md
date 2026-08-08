# Communication Standard: ASD-STE100

This is the writing standard for EasyShiftHQ. It applies to Claude and to all
sub-agents. It applies to chat replies, design docs, plans, commit messages, PR
bodies, code comments, and retrospectives.

ASD-STE100 is Simplified Technical English. It is a controlled language. It
limits vocabulary and grammar to remove ambiguity.

## Scope and honest limits

The full specification has two parts:

1. **Part 1 — 65 writing rules.** This document contains them. Claude can obey
   them fully.
2. **Part 2 — a dictionary of approximately 900 approved words.** ASD licenses
   this dictionary. Claude does not have the full word list. Claude approximates
   it with the rules and the word table below.

Therefore: call this standard **STE-aligned**, not **STE-certified**. Do not
claim certification in any document.

## The 15 rules that do the work

Obey these on every sentence.

1. **One idea per sentence.** Do not join two ideas with "and" or a semicolon.
2. **Maximum 20 words** in an instruction. Maximum 25 words in a description.
3. **Maximum 6 sentences** in a descriptive paragraph. Maximum 3 in a procedure
   step.
4. **Use the active voice.** Write "The hook adds the rule." Do not write "The
   rule is added by the hook."
5. **Start an instruction with the verb.** Write "Run the tests." Do not write
   "You should probably run the tests."
6. **Use one word for one meaning.** Pick "fix". Do not also write "repair",
   "address", "resolve", "patch", or "sort out".
7. **Use simple tenses only.** Use the simple present, the simple past, and the
   simple future. Do not use the perfect tenses.
8. **Do not use an -ing word as a noun.** Write "The sync fails." Do not write
   "Syncing is failing."
9. **Keep the articles.** Write "the query". Do not write "query".
10. **Maximum 3 nouns in a cluster.** Write "the cursor for the Toast sync". Do
    not write "the Toast sync cursor column value".
11. **Write positive instructions.** Write "Keep the loop bounded." Prefer this
    to "Do not leave the loop unbounded."
12. **Give the warning before the instruction.** Write "This deletes 40 rows.
    Confirm first."
13. **Use a vertical list** for more than two conditions or more than two steps.
14. **No idioms, no slang, no metaphors.** Do not write "grading its own
    homework", "under the hood", or "let's dig in".
15. **No hedges and no filler.** Delete "basically", "essentially", "actually",
    "I think", "it seems", "just", "simply", and "of course".

## Words that stay

STE permits **technical names** and **technical verbs**. This project uses many.
Keep them exactly as they are:

- Product and tool names: Supabase, Toast, Square, Clover, Shift4, Stripe, React
  Query, Vitest, Playwright, pgTAP, CodeRabbit, SonarCloud.
- Code identifiers: `restaurant_id`, `unified_sales`, `useAuth()`, RLS, RPC, CORS,
  P&L.
- Domain nouns: migration, edge function, worktree, hook, skill, cron job.

Do not translate a code identifier into plain English. Quote it exactly.

## Approved verb list for this project

Use the left column. Do not use the right column.

| Use | Do not use |
|-----|-----------|
| add | introduce, bring in, wire up |
| change | modify, alter, tweak, adjust, revise |
| delete | remove, drop, strip, purge, clean up |
| fix | repair, resolve, address, patch, handle |
| find | locate, discover, surface, uncover, spot |
| show | display, surface, render, expose, reveal |
| start | launch, kick off, spin up, fire up |
| stop | halt, kill, terminate, tear down |
| read | inspect, examine, review (for files) |
| check | verify, validate, confirm, ensure, assess |
| make | create, generate, produce, build (for files) |
| let | allow, permit, enable (for people) |
| use | leverage, utilize, employ |
| get | fetch, retrieve, obtain, pull |
| send | dispatch, transmit, push, deliver |
| fail | break, blow up, choke, regress |

Two exceptions. Keep **build** for a compiled artifact (`npm run build`). Keep
**create** and **delete** for SQL and for git, because they are technical verbs
there (`CREATE TABLE`, `git worktree create`).

## Approved adjective and connector list

| Use | Do not use |
|-----|-----------|
| correct / not correct | right, valid, sound, proper |
| the same | identical, equivalent, analogous |
| different | divergent, disparate, distinct |
| large / small | significant, substantial, minor, trivial |
| first / then / last | initially, subsequently, ultimately |
| because | since, as, given that, due to the fact that |
| but | however, although, whereas, that said |
| if | should, in the event that, provided that |

## Examples

**Not STE:**

> I've gone ahead and refactored the Toast order processor a bit — basically it
> was doing per-order RPC calls which was hammering the CPU limit, so I've
> batched them up, and it should be significantly faster now.

**STE:**

> I changed the Toast order processor. Before, it made one RPC call for each
> order. This went above the CPU limit of the edge function. Now it makes one
> call for each batch. The sync of 200 orders takes 3 seconds. Before, it took
> 41 seconds.

**Not STE:**

> There's a potential race condition lurking here if two users hit save at the
> same time.

**STE:**

> This code has a race condition. Two users can save at the same time. The
> second save then overwrites the first save.

## How to check your own text

Read each sentence. Ask four questions:

1. Does it have more than 20 words?
2. Does it have more than one idea?
3. Does it use a word from the right column of a table above?
4. Can a reader with limited English misread it?

If the answer to any question is yes, rewrite the sentence.

## What this standard does not change

- Code, SQL, and test names keep their normal style.
- Quotes from tool output, error messages, and logs stay exact. Do not rewrite
  them.
- Quotes from third-party reviewers stay exact.
