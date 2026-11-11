# Innow LINE MINI App (line-app)

Cloudflare Worker + D1 (`innow-line`) + R2 (`innow-line-files`) serving the learner app (`public/`) and the API (`src/worker.js`).
Current config is the TEST setup (provider "Bot 2023", MINI App "Innow Test", Unverified). See `wrangler.jsonc`.

## Prerequisites

- `npx wrangler login` (account that owns the bucket and database)
- R2 bucket `innow-line-files` exists, D1 database `innow-line` exists (id is in `wrangler.jsonc`)
- `npm install` in `line-app/`, then `npm test` passes

## Deploy

```sh
cd line-app
npx wrangler d1 migrations apply innow-line --remote

openssl rand -base64 48            # copy the output, paste it at the next prompt
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put WEB_INQUIRY_SECRET   # website quote requests, see below

npx wrangler deploy
```

- Secrets are typed at the prompt only. Never commit them, never put them in a tracked file.
- Do NOT run `wrangler secret bulk` with `.dev.vars`: it contains `DEV_FAKE_LINE`, which must never exist in production.
- Rotating `SESSION_SECRET` logs everyone out (members and admin).
- `WEB_INQUIRY_SECRET`: generate it with `openssl rand -base64 48`, never commit it. It must equal the website's Vercel env var `LINE_INQUIRY_SECRET`. Without it (or if shorter than 32 chars) the endpoint below answers 503.
- Website quote requests: the website posts `POST /api/inquiry/web` with `Authorization: Bearer <WEB_INQUIRY_SECRET>` and JSON `{organization, email, course, expectation, details, learners, emailSent}` after it has emailed the request itself. The Worker only stores it (`source = 'web'`) so it shows in the admin tab "คำขอใบเสนอราคา"; it sends no email and has no CORS. A global cap of 120 requests/hour (`WEB_INQUIRY_CAP_PER_HOUR`) limits damage from a leaked secret.
- Loop guard: the Worker's own forward of LINE quote requests to `INQUIRY_FORWARD_URL` carries `x-innow-origin: line`, so the website's handler must not call `/api/inquiry/web` for those requests (otherwise they would be recorded twice).
- `wrangler deploy` prints the URL, expected form `https://innow-line.<account-subdomain>.workers.dev`. Use it as the Endpoint URL below.

## LINE console (test setup)

1. LINE Developers console, provider "Bot 2023", MINI App channel "Innow Test": `/console/channel/2012557246/mini-liff`.
2. Developing channel: set the Endpoint URL to the deployed Worker URL (https, no trailing path).
3. Confirm the linked OA is "Bot 2023" (@276eafaf). Turn on the "Add friend" option so members are prompted to add the OA (verify in the console where this setting lives).
4. Roles: add every person who will test as a Tester (in Developing mode only testers can open the app).
5. Open `https://miniapp.line.me/2012557246-GV0GKhsl` from LINE on a phone. Deep links: `...?p=workshops|redeem|prompts|contact`.

`LIFF_ID` is the Developing LIFF ID. The Worker accepts tokens from any channel in `LINE_LOGIN_CHANNEL_ID`
(`2012557246,2012557247,2012557248` = developing/review/published). At go-live replace `LIFF_ID`, `LINE_LOGIN_CHANNEL_ID`
and `OA_BASIC_ID` in `wrangler.jsonc` with the production Innow values and redeploy.

## Rich menu

Run by the OWNER in their own terminal (the channel access token must not be pasted into chat or files).
The token is Messaging API > Channel access token of the OA, and is only sent to api.line.me.

Typing the token inline (`LINE_CHANNEL_ACCESS_TOKEN=... node ...`) stores it in shell history. Read it silently instead
(or start the line with a space if `HISTCONTROL=ignorespace`), and unset it afterwards:

```sh
cd line-app
read -rs LINE_CHANNEL_ACCESS_TOKEN && export LINE_CHANNEL_ACCESS_TOKEN
export LIFF_ID=2012557246-GV0GKhsl OA_BASIC_ID=@276eafaf
node richmenu/create.mjs --dry-run                                            # no network
node richmenu/create.mjs --confirm --user U0123456789abcdef0123456789abcdef   # test OA first: one user only
node richmenu/create.mjs --confirm                                            # default menu for ALL friends
unset LINE_CHANNEL_ACCESS_TOKEN
```

WARNING: `--confirm` without `--user` sets the menu as the DEFAULT for every friend of the OA. Use `--user <LINE user id>`
first on the test OA. The script accepts only `--dry-run`, `--confirm` and `--user <id>` (separate argument); `--user=<id>`
and any unknown flag are rejected before any network call.

(`POST /v2/bot/user/{userId}/richmenu/{richMenuId}`; the user id is `U` + 32 hex characters.)
On failure the script deletes the menu it just created. Buttons 1, 2, 3, 6 open `https://miniapp.line.me/<liffId>?p=...`.

## Post-deploy smoke test

- [ ] Admin login at `/admin.html`, wrong password rejected
- [ ] Create a workshop, then create a 4-digit code
- [ ] In LINE (as a tester): open the app, redeem the code, workshop appears
- [ ] Privacy dialog opens and shows the responsible person and retention text
- [ ] Contact wizard (one question per screen) submits; admin tab "คำขอใบเสนอราคา" shows it; CSV export works
- [ ] File upload (slide/PDF) works; PDF preview opens in real Chrome and Edge under the admin CSP
- [ ] Add friend gate: a non-friend (or blocked) account sees the Add friend page
- [ ] "ติดต่อเรา" OA chat link opens the chat (the URL keeps its trailing slash)
- [ ] Rich menu (test OA / one user): all six buttons open the right place

## Known limits and deferred work

- Fonts are self-hosted in `public/fonts/` (copies of `../fonts/*.ttf`, full TTFs, about 580 KB, no subsetting); the app makes no request to Google Fonts. Re-copy them if the Design System fonts change. Emoji and characters outside Thai/Latin fall back to the OS font.
- Upload size limit: 40 MB per file.
- Developing mode: only users with a role (Tester/Admin) can open the app.
- LINE access tokens last 12 hours; after that members must reopen the app (inside LINE the app never calls `liff.login()`).
- Deferred: log cleanup/retention job, PDPA delete/withdraw endpoints, admin logout, unique index for `newCode` collisions.
