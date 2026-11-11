# Innow LINE MINI App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A LINE MINI App plus admin page, running on Cloudflare, that follows the blueprint's six-step Student journey and ships a 6-button rich menu for the Innow LINE OA.

**Architecture:** One Cloudflare Worker (`line-app/src/worker.js`) serves static learner and admin pages from `line-app/public/`, a JSON API, and signed file downloads from R2. D1 holds workshops, codes, members, enrollments, items, attempts and audit log. Learner identity is a LINE access token verified against LINE, exchanged for a 7-day HMAC bearer token.

**Tech Stack:** Cloudflare Workers, D1, R2, wrangler 4, LIFF SDK v2, vanilla JS/CSS (no build step), `node --test` for tests.

**Spec:** `docs/superpowers/specs/2026-11-11-innow-line-mini-app-design.md` (blueprint: `~/Downloads/innow_line_mini_app_plan.html`)

## State of the repo (read first)

A first draft already exists, written before the plan was approved, and is **untested**: `line-app/wrangler.jsonc`, `migrations/0001_init.sql`, `src/lib.js`, `src/worker.js`, `public/index.html`, `public/app.css`. D1 database `innow-line` (id `8025266b-92c7-4e9a-af71-eed025bde34e`) is created and empty. The R2 bucket is NOT created (R2 not enabled on the account). Tasks below test the draft and fix or extend it; do not rewrite what passes.

## Global Constraints

- Brand: fonts Anuphan (display) and IBM Plex Sans Thai (reading); navy `#082955`, blue `#014799`; Thai UI copy, sentence case.
- Code is 4 digits `^\d{4}$`, per workshop, default 5 minutes (admin range 1 minute to 24 hours); issuing a code revokes the workshop's previous active code.
- Wrong codes: 5 failures per 10 minutes per LINE user. Admin login: 10 failures per 10 minutes per IP.
- Wrong, expired and revoked codes give the same message; lockout has its own message.
- Learner session: bearer token, 7 days, no cookies. Admin session: 12 hours. Signed file link: 5 minutes.
- Upload limit 95 MB through the Worker; larger material is an `https://` link item.
- `ADMIN_PASSWORD` (value supplied by the owner in chat; set it with `wrangler secret put`, never write it to a file) and `SESSION_SECRET` (random, 32+ chars) are Worker secrets, never committed. `.dev.vars` is git-ignored.
- Email stored unverified; marketing consent is a separate unticked checkbox.
- Rich menu: 2500 x 1686, 3 x 2, buttons Workshop, รับสิทธิ์, Prompt Library, Bonus, ข่าวสาร (https://www.facebook.com/innow.co.th), ติดต่อเรา (opens OA chat).
- Workshop = one class round. Prompt Library and Bonus menu buttons show combined items of all enrolled workshops, grouped by workshop.
- Do not touch the existing Vercel contact form (`api/`, `lib/`, root `index.html`).

## Review Focus

1. Code `0042` (leading zeros) works and is not coerced to a number anywhere.
2. Double-tapping the register button submits once; a second submit with the same redeem token must not create a second member or error confusingly.
3. Learner token expires mid-session: the app silently re-authenticates through LIFF instead of showing a raw error.
4. A member of workshop A requests a file link or workshop JSON for workshop B by changing the ID: 403.
5. CSV export of members where a name or email starts with `=`, `+`, `-` or `@`: cells are neutralised so Excel does not run them.

---

### Task 1: Test harness and `lib.js` unit tests

**Files:**
- Create: `line-app/package.json` (scripts `test`, `dev`, `deploy`; devDependency `wrangler@4`)
- Create: `line-app/tests/lib.test.mjs`
- Modify: `line-app/src/lib.js` if a test fails
- Modify: `/.gitignore` (add `.dev.vars`, `.wrangler`)

**Interfaces:**
- Produces: `npm test` in `line-app/` runs `node --test tests/`.

- [ ] **Step 1: Write failing tests** in `lib.test.mjs`: `signToken/verifyToken` round-trip; rejects wrong `typ`, tampered body, expired (pass `now` in the future); `isFourDigits('0042') === true`, `'42'`, `'12345'`, `'abcd'`, `4242` (number) all false except the first; `randomCode(new Set())` always matches `^\d{4}$` and avoids a taken set of 9,999 codes (returns the one free code); `validateRegistration` rejects empty names, bad email, missing `acceptTerms`, and lower-cases/trims email, `marketing` true only when `=== true`; `timingSafeEqualStr('a','a')` true, different length false; `slugify('Claude Code 2 วัน')` is non-empty, `[a-z0-9-]` only.
- [ ] **Step 2: Run** `cd line-app && npm test`. Expected: FAIL only where the draft is wrong (fix `lib.js`); if all pass, note that and continue.
- [ ] **Step 3: Fix `lib.js`** until green.
- [ ] **Step 4: Commit** `test: cover line-app lib helpers`.

### Task 2: Local API harness and member API tests

**Files:**
- Create: `line-app/.dev.vars` (`SESSION_SECRET`, `ADMIN_PASSWORD=<owner-supplied value>`, `DEV_FAKE_LINE=1`, `LINE_LOGIN_CHANNEL_ID=test`) — not committed
- Create: `line-app/tests/api.helper.mjs` (starts `wrangler dev --local --port 8799`, applies migrations to a local D1, exports `call(method, path, {token, json})` and `stop()`)
- Create: `line-app/tests/member.test.mjs`
- Modify: `line-app/src/worker.js`

**Interfaces:**
- Consumes: Task 1 harness. `DEV_FAKE_LINE=1` makes access tokens of the form `dev:<userId>` valid; a user id containing `nofriend` is not a friend.
- Produces: `call()` and an `adminLogin()` helper returning an admin token; `seedWorkshop(title)` returns `{id, code}` via the admin API. Later tasks reuse these.

- [ ] **Step 1: Write failing tests** in `member.test.mjs` for the six steps: `POST /api/auth` with `dev:u1` returns `isFriend:true`, no member; with `dev:nofriend1` returns `isFriend:false` and `GET /api/me` with that session returns 403 with `notFriend:true`; redeem valid code for new user returns `status:'register'` and a `redeemToken`; `POST /api/register` with valid input returns `enrolled`, then `GET /api/me` lists the workshop; second user who is already a member redeems a different workshop's code and gets `enrolled` with no register step; re-redeeming the same code returns `already`; a wrong code returns 400 with the generic message, the sixth attempt within the window returns 429; expired code (issue with `minutes:1`, then insert a past `expires_at` via admin test hook or wait-free SQL) returns the same generic 400; code `0042` is accepted when issued; register without `acceptTerms` returns 422 with `errors.acceptTerms`; register twice with the same `redeemToken` leaves exactly one member row (Review Focus 2); user in workshop A calling `GET /api/workshops/<B>` gets 403 (Review Focus 4); `POST /api/items/<id>/link` for a file in a workshop the user is not in gets 403.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (harness missing).
- [ ] **Step 3: Implement the harness and fix `worker.js`** until green. Known draft gap: code issuance does not need a test hook for expiry — add `POST /api/admin/_test/expire` only when `DEV_FAKE_LINE=1`, or backdate via `wrangler d1 execute --local`.
- [ ] **Step 4: Run** all tests. Expected: PASS.
- [ ] **Step 5: Commit** `test: member API journey, rate limit, isolation`.

### Task 3: Admin API tests, CSV export, copy-from-previous-round

**Files:**
- Create: `line-app/tests/admin.test.mjs`
- Modify: `line-app/src/worker.js`, `line-app/src/lib.js`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: `GET /api/admin/members.csv?workshop=<id>` (text/csv, UTF-8 with BOM); `POST /api/admin/workshops/:id/copy-from/:sourceId` copies prompt, bonus and slide items (files copied within R2 under new keys) and returns `{copied:n}`; `lib.csvCell(value: string): string` quoting and neutralising leading `= + - @`.

- [ ] **Step 1: Write failing tests:** any `/api/admin/*` without a token is 401; wrong password 401 and the 11th wrong attempt from one IP is 429; correct password returns a token; create/update/delete workshop; new code revokes the previous active one (the old code now fails at redeem); `minutes` clamps to 1 and 1440; item create without title is 422, with `http://` url is 422; item `kind` outside slide/prompt/bonus is 422; `lib.csvCell('=1+1')` starts with `'`; `csvCell('a,"b"')` is quoted with doubled quotes; CSV export contains header and a registered member (Review Focus 5); `copy-from` copies N items and leaves the source intact; removing an enrollment makes that learner's `GET /api/workshops/:id` 403 again; deleting a workshop removes its codes, enrollments and items.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (CSV and copy missing).
- [ ] **Step 3: Implement** `csvCell` in `lib.js` and the two routes in `worker.js`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: admin CSV export and copy content between rounds`.

### Task 4: File upload and signed download (needs R2)

**Files:**
- Create: `line-app/tests/files.test.mjs`
- Modify: `line-app/src/worker.js` if a test fails

**Interfaces:**
- Consumes: Task 2 helpers; local R2 (wrangler simulates it, no account R2 needed for tests).

- [ ] **Step 1: Write failing tests:** admin uploads a small PDF as a slide via multipart; enrolled learner `POST /api/items/:id/link` returns a URL; `GET` that URL returns the same bytes with `content-disposition` and `cache-control: private, no-store`; the URL with a changed `t` or a token for another item returns 403; a token issued with `ttl` past (use `signToken` with an old `now` in the test) returns 403; replacing the file deletes the old R2 object; upload over 95 MB returns 413 (use a 96 MB stream); file name with quotes or newlines is sanitised in the header.
- [ ] **Step 2: Run, fix, re-run** until PASS.
- [ ] **Step 3: Commit** `test: R2 upload and signed links`.

### Task 5: Learner app (`public/app.js`) — Student journey screens

**Files:**
- Create: `line-app/public/app.js`
- Modify: `line-app/public/index.html`, `line-app/public/app.css`

**Interfaces:**
- Consumes: API from Tasks 2-4. Deep links: `?p=workshops`, `?p=redeem`, `?p=prompts`, `?p=bonus`, `?p=profile`, `?p=workshop&id=<id>` (the LIFF endpoint receives these from rich menu URLs `https://liff.line.me/<LIFF_ID>?p=...`).
- Produces: `window.__app` exposing `go(route)` for browser tests.

- [ ] **Step 1: Implement `app.js`** as an ES module with: `boot()` → `GET /api/config`; init LIFF (`liff.init`, `liff.login` if logged out; when `dev:true` and not in LINE, use a `?dev=<userId>` query to fake `dev:<userId>`); `POST /api/auth`; store session in memory and `sessionStorage`. Step 02 gate: if `!isFriend` render the Add/Unblock page (add-friend link `https://line.me/R/ti/p/<OA_BASIC_ID>`, button "ตรวจอีกครั้ง" re-runs auth). Routes: home (hero card, tiles Slide-less library entry), `workshops` (cards, tap opens workshop), `workshop` (four tiles; Certificate disabled with "Coming Soon"; items per kind; slides open via `/api/items/:id/link` then `liff.openWindow({external:true})`; prompts show text with a Copy button; bonus shows files/links), `prompts` and `bonus` (combined, grouped by workshop), `redeem` (four single-digit inputs, auto-advance, paste fills all, `inputmode=numeric`; sends the string, never a number), `register` (fields, privacy dialog, separate marketing checkbox, submit button disables while in flight), `profile` (name, email, LINE profile, workshops count). Any 401 with `reauth` triggers one silent re-auth and retry (Review Focus 3). Empty states per spec. Tab bar from the existing markup.
- [ ] **Step 2: Verify in the browser pane** with `wrangler dev` and `?dev=u1`: walk all six steps for a new user and an existing user; `?dev=nofriend1` shows the Add page; wrong code shows the generic message; mobile viewport 375 px has no horizontal scroll and tap targets are at least 44 px. Capture a screenshot of each screen.
- [ ] **Step 3: Commit** `feat: learner app following the Student journey`.

### Task 6: Admin page

**Files:**
- Create: `line-app/public/admin.html`, `line-app/public/admin.js`

**Interfaces:**
- Consumes: admin API from Tasks 2-4. Served at `/admin.html`; the learner app never links to it.

- [ ] **Step 1: Implement:** password screen (token kept in `sessionStorage`); dashboard counts; workshop list with create/edit/delete; per-workshop panel with a large code display (current code in big digits, countdown, "สร้างรหัสใหม่" with minutes select, "ยกเลิกรหัส"), content tabs for slide/prompt/bonus with add/edit/delete, file upload with progress, link field, sort order, "คัดลอกเนื้อหาจากรอบก่อน" select; members tab with remove-enrollment and CSV download; audit log tab. Desktop-first, usable on a tablet. Instructor use case: the code screen must be readable from across a room.
- [ ] **Step 2: Verify in the browser pane** end to end: create workshop, add one of each item kind, issue a code, enter it as learner `dev:u1`, see the item, remove enrollment, confirm access is gone. Screenshot the admin code screen.
- [ ] **Step 3: Commit** `feat: admin page`.

### Task 7: Rich menu (image and creation script)

**Files:**
- Create: `line-app/richmenu/richmenu.html` (2500 x 1686 layout, brand colours, 6 cells), `line-app/richmenu/render.mjs` (screenshots to `richmenu.png` using the browser), `line-app/richmenu/create.mjs`, `line-app/tests/richmenu.test.mjs`

**Interfaces:**
- Produces: `buildRichMenu(liffId: string, oaBasicId: string): object` exported from `create.mjs`, the request body for `POST https://api.line.me/v2/bot/richmenu`.

- [ ] **Step 1: Write failing test** in `richmenu.test.mjs`: `buildRichMenu('1234-abcd','@innow')` has `size` 2500 x 1686, `selected:true`, six areas that tile the whole image with no gaps or overlap (each 833/834 wide x 843 high), actions in order: uri `https://liff.line.me/1234-abcd?p=workshops`, `?p=redeem`, `?p=prompts`, `?p=bonus`, uri `https://www.facebook.com/innow.co.th`, uri `https://line.me/R/oaMessage/@innow/`; `chatBarText` is 80 characters or fewer.
- [ ] **Step 2: Run, implement `buildRichMenu`, run to PASS.**
- [ ] **Step 3: Render the PNG** and check it visually; file size under 1 MB.
- [ ] **Step 4: `create.mjs`** reads `LINE_CHANNEL_ACCESS_TOKEN`, `LIFF_ID`, `OA_BASIC_ID` from the environment, creates the menu, uploads the image to `https://api-data.line.me/v2/bot/richmenu/{id}/content`, sets it as default (`POST /v2/bot/user/all/richmenu/{id}`), and prints the id. It must refuse to run without all three variables. Token is never written to disk or logged.
- [ ] **Step 5: Commit** `feat: rich menu image and creation script`.

### Task 8: Deploy, LINE setup, end-to-end on the dev OA

**Files:**
- Modify: `line-app/wrangler.jsonc` (vars `LIFF_ID`, `LINE_LOGIN_CHANNEL_ID`, `OA_BASIC_ID`)

**Interfaces:**
- Consumes: R2 enabled by the owner; LIFF ID, Login channel ID, OA basic ID, dev OA channel access token from the owner.

- [ ] **Step 1: Owner enables R2** in the Cloudflare dashboard; then `npx wrangler r2 bucket create innow-line-files`. Expected: bucket listed by `wrangler r2 bucket list`.
- [ ] **Step 2: Remote setup:** `npx wrangler d1 migrations apply innow-line --remote`; `npx wrangler secret put SESSION_SECRET` (random 48 chars) and `ADMIN_PASSWORD`; set vars in `wrangler.jsonc`; `npx wrangler deploy`. Expected: URL `https://innow-line.<subdomain>.workers.dev`; `curl <url>/api/config` returns JSON with `dev:false`.
- [ ] **Step 3: Owner sets the LIFF endpoint URL** in LINE Developers to the Worker URL and confirms the Login channel is under the same provider as the dev OA.
- [ ] **Step 4: Run `create.mjs`** against the dev OA.
- [ ] **Step 5: End-to-end on a real phone with the dev OA:** add OA, tap รับสิทธิ์, enter an admin-issued code, register, open the slide, tap each of the six menu buttons. Record what worked and what did not.
- [ ] **Step 6: Commit** `chore: deploy config for innow-line`.

---

## Self-review notes

- Spec coverage: six-step journey (Tasks 2, 5), gate and Add/Unblock (Tasks 2, 5), 4-digit codes and limits (Tasks 1, 2, 3), library and four sections (Task 5), rich menu (Task 7), admin incl. codes/files/prompts/members/audit (Tasks 3, 4, 6), signed files (Task 4), PDPA notice and CSV (Tasks 3, 5), Cloudflare deploy (Task 8). Out-of-scope items are not planned.
- Not planned on purpose: email verification, Service Message, certificates, production OA cut-over (same Worker, change vars and run `create.mjs` with the production token after dev passes).
- Known risk: `liff.openWindow` behaviour for PDFs inside LINE's in-app browser is verified only in Task 8 on a real phone.
