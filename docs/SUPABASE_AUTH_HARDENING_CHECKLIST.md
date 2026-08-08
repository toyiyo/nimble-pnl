# Supabase Auth Hardening Checklist (Track B)

**Owner:** Jose. Do these in the Supabase dashboard. No agent can do them.
**Project:** `ncdujvdgqtaunuyigflp` (production).
**Source:** `docs/SECURITY_AUDIT_ACCOUNT_CREATION_2026-08.md`
**Code side:** `docs/plans/2026-08-07-account-creation-security-plan.md`

These settings are **not** in `supabase/config.toml`. The `[auth]` block at
`supabase/config.toml:11-15` has no `[auth.email]` sub-section, so the hosted
dashboard is the only control.

---

## Warning: read this before step B1

**Step B1 breaks the E2E suite.** 154 of 280 production accounts use `test.com`
addresses and are unconfirmed. Every signup test creates one. Confirm email
will block them all.

**Do Task 8 step 4 of the code plan first, or on the same day.** That step
changes `generateTestUser()` to create users through the admin API with
`email_confirm: true`.

---

## B1 — Turn on Confirm email

**Path:** Authentication → Providers → Email → **Confirm email** → ON.

**Why:** Auto-confirm is ON today. Measured on 2026-08-07: 71 of 72 real-domain
accounts show `email_confirmed_at` set, but only **3** ever had a confirmation
email queued. 53 confirmed within 2 seconds of `created_at`. No human opens an
inbox in 2 seconds. Email verification does not gate anything right now.

**This is the single highest-value change in the whole audit.** It ends
disposable-address account farming.

- [ ] Check the email template first: Authentication → Email Templates → Confirm
      signup. Confirm the redirect URL matches `site_url`.
- [ ] Check your SMTP sender. The default Supabase sender has a low hourly cap
      and will silently throttle real signups. Set a custom SMTP provider if you
      have not.
- [ ] Turn on Confirm email.
- [ ] Register one real test account and confirm the email arrives.

---

## B2 — Turn on CAPTCHA

**Path:** Authentication → Settings → **Enable CAPTCHA protection**.

**Provider:** Cloudflare Turnstile (recommended — free, no user puzzle) or
hCaptcha.

**Why:** A repo-wide grep for `captcha`, `turnstile`, `hcaptcha`, `recaptcha`
returns zero hits. Nothing stands between a script and `supabase.auth.signUp`.

- [ ] Create a Turnstile site at `dash.cloudflare.com` → Turnstile.
- [ ] Paste the **secret key** into the Supabase dashboard.
- [ ] Give the **site key** to the code session doing Task 8. It is public and
      safe to commit.
- [ ] Create a second Turnstile site in **"Always passes"** test mode. Give that
      secret to the E2E environment so tests keep working.

---

## B3 — Turn on Leaked Password Protection

**Path:** Authentication → Settings → **Leaked password protection** → ON.

**Why:** The Supabase security advisor flags this as disabled. Breached
passwords are accepted today. This checks new passwords against HaveIBeenPwned
with a k-anonymity hash prefix. No password leaves the service.

- [ ] Turn it on.
- [ ] Set **Minimum password length** to 8, to match
      `src/pages/ResetPassword.tsx:13-17`.
- [ ] Set required character types to lower + upper + digit, to match the same
      file.

This makes the code change in Task 8 a defense-in-depth duplicate rather than
the only control. Do both.

---

## B4 — Lower the auth rate limits

**Path:** Authentication → Rate Limits.

**Why:** There is no application-layer throttle anywhere in the codebase. The
dashboard limits are the only throttle that exists today.

- [ ] **Sign ups / sign ins:** lower from the default. A real restaurant
      operator signs up once. 30 per hour per IP is generous.
- [ ] **Email sends:** set this to match your SMTP provider's real cap, or
      confirmation emails will drop silently.
- [ ] **Token refresh:** leave at the default. A low value logs out real users.
- [ ] **Anonymous sign-ins:** set to 0 if you do not use them. Grep found no
      `signInAnonymously` caller.

Note the limits are **per IP**. A distributed bot fleet defeats them. They raise
the cost; they do not stop a determined attacker. B1 and B2 do the real work.

---

## B5 — Consider Cloudflare in front

Optional. Do it only after B1-B4.

**Why:** Supabase's own rate limits are per IP and cannot see a pattern across
IPs. Cloudflare adds bot scoring and a managed challenge.

- [ ] Put the app domain behind Cloudflare.
- [ ] Add a WAF rate-limit rule on the auth paths.
- [ ] Turn on Bot Fight Mode.

---

## B6 — Clean up the test accounts

**Do this last, and confirm the cause first.**

154 of 280 accounts use `test.com` (RFC 2606 reserved, non-deliverable). All are
unconfirmed. They account for every signup burst window in the data. This is
almost certainly the project's own E2E suite hitting production.

- [ ] **First, answer this:** does the E2E suite point at production? Check the
      CI environment variables. If it does, point it at a branch database or a
      separate project. **Do this before any deletion**, or the accounts come
      straight back.
- [ ] Only then delete the `test.com` accounts. Ask a Claude Code session to
      write and review the delete statement. Production writes need your
      explicit approval with exact row counts.
- [ ] 169 of 280 accounts (60%) never joined a restaurant. Do **not** bulk-delete
      those. Some are real people who signed up and stalled.

---

## Order and effort

| Step | Effort | Blocks | Blocked by |
|---|---|---|---|
| B1 Confirm email | 15 min | Task 8, Task 10 step 3 | Task 8 step 4 (E2E fix) |
| B2 CAPTCHA | 20 min | Task 8 | — |
| B3 Leaked passwords | 2 min | — | — |
| B4 Rate limits | 10 min | — | — |
| B5 Cloudflare | 1-2 h | — | B1-B4 |
| B6 Test cleanup | 30 min | — | CI environment fix |

**Do B3 and B4 right now.** They take 12 minutes, break nothing, and need no
code change.
