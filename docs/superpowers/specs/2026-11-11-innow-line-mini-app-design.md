# Innow LINE MINI App + LINE OA Rich Menu — Design

Source blueprint: `~/Downloads/innow_line_mini_app_plan.html` (11 Nov 2026). This document adds the decisions made in conversation. Where they differ, this document wins.

## Intent

Turn workshop attendees into Innow members on LINE. After a workshop, an attendee can come back to the slides, prompts and bonus material of the workshop they actually attended, from the Innow LINE OA, without creating a new password.

Success: on workshop day an attendee scans a QR code, adds the OA, enters a 4-digit code from the instructor, registers once, and sees that workshop's content on their phone. Next time they open it from the OA rich menu and are already in.

## The learner path (canonical: "Student journey" in the blueprint, confirmed by the owner)

1. **Add LINE OA.** Scan the venue QR, add the Innow OA as a friend. The rich menu appears.
2. **Open MINI App + LINE Login.** Verify the LINE account and check friend status. If the learner opened the app from another link before adding the OA, or has blocked it, show an Add / Unblock page with a "check again" button, then continue.
3. **Enter the 4-digit code** the instructor announces. The server checks the code, its expiry, and the failed-attempt count.
4. **Register (first time only).** First name, last name, email, accept the privacy notice. Shown only after a valid code and only to people who are not yet members. Existing members skip it.
5. **Save the entitlement.** The workshop is bound to the verified LINE account. Re-entering the same code does not create a second entitlement but does take the learner to the content.
6. **Open Workshop Library.** The learner picks a workshop, then sees its four sections: Slide, Prompt Library, Bonus, Certificate (Coming Soon, not built). They come back later from the rich menu.

New member: valid code, register, entitlement saved, workshop opens. Existing member: valid code, entitlement added to the existing account at once, no form.

Rich menu, 6 buttons (3 x 2): Workshop, รับสิทธิ์, Prompt Library, **ดูผลงานของเรา** (opens https://innow.co.th directly; replaces the blueprint's Bonus button, owner decision 2026-11-11), ข่าวสาร (opens facebook.com/innow.co.th), ติดต่อเรา (sublabel **สอบถามข้อมูล**; opens the contact page, see "Contact menu"). Bonus material is still reachable inside each workshop and at `?p=bonus`, just not from the rich menu.

## Goals

- Everything in the blueprint's "in scope" list, including the 6-button rich menu.
- An admin page so staff can run it without a developer: create workshops, issue and rotate 4-digit codes, upload slides and bonus files, edit prompts, see members, see the audit log.
- Content only reachable by members enrolled in that workshop. Forwarding a link must not unlock anything.

## Non-goals (from the blueprint, unchanged)

Verified MINI App status, Service Message / Notice, custom path URL, Add to Home Screen, in-app news, real certificates, payments, email+password sign-up, native apps.

## Anti-goals (a failure even if it technically works)

- A learner can open another workshop's files by guessing IDs or reusing a link.
- A code can be brute-forced (only 10,000 combinations).
- Student names and emails are readable without the admin password.

## Decisions

Made by the owner:

- Stack: Cloudflare Workers + D1 + R2, account paiboon@innow.co.th, already logged in on the dev machine. One Worker serves the learner app (static files), the API and the admin page. The existing Vercel contact form is not touched.
- Code lives in `innow-web/line-app/` (separate from the marketing site).
- Admin page protected by one shared password, chosen by the owner and given in chat (not recorded in this repository).
- Two LINE OAs exist: Innow (production) and Innow dev. Build and test against dev first.

My calls (owner can override):

- Codes are per workshop, 5 minutes by default, adjustable at issue time (1 minute to 24 hours). Issuing a new code revokes the previous active code for that workshop.
- Wrong codes are limited to 5 per 10 minutes per LINE user, enforced on the server. Admin login is limited to 10 failures per 10 minutes per IP.
- The admin password is stored as a Worker secret, never in the repository. The one the owner chose is weak for something guarding student personal data; I recommend changing it after launch.
- Someone who is a friend of the OA but has no workshop yet sees an empty Workshop Library with a button to enter a code.
- Files are stored in a private R2 bucket and served only through the Worker with a 5-minute signed link, after an enrollment check. Link items (https only) are also supported for slides hosted elsewhere.
- Email is stored unverified; marketing consent is a separate, unticked checkbox.
- Prompts are text with a title and category, shown with a copy button.
- The friendship check uses LINE's friendship status API. If it cannot be read, the user is treated as not a friend and is asked to add the OA.

## Constraints and dependencies

- R2 is not enabled on the Cloudflare account yet. The owner must enable it once in the Cloudflare dashboard (R2 > Get started; it may ask for a payment method). Until then file upload cannot work; everything else can.
- The owner must supply, from LINE Developers: the LIFF ID, the Login/MINI App channel ID, the OA basic ID, and (for creating the rich menu) the OA's Messaging API channel access token. The Login channel must be under the same provider as the OA.
- The rich menu image (2500 x 1686) is generated by us in Innow brand colours and fonts.
- The 4-digit code is not proof someone is in the room. If stricter control is needed, use a roll call alongside it.

## Left to the builder

Visual details of the learner app and admin page (Innow brand: Anuphan, IBM Plex Sans Thai, navy/blue palette from the main site), database indexes, error wording, test structure.

## Additional calls after the builder check (mine, owner can override)

- Rich menu Prompt Library and Bonus show the combined items of every workshop the learner is enrolled in, grouped by workshop. No workshop yet: empty state with an enter-code button.
- Entering a valid code for a workshop the learner already has takes them to that workshop. It does not create a second enrollment (idempotent); the attempt is logged.
- Wrong, expired and revoked codes share one message (so a guesser learns nothing); the 5-per-10-minutes lockout shows its own message.
- Learner session is a bearer token (7 days) from `liff.getAccessToken()`, verified against LINE on every login. No cookies.
- One Worker, one D1 database, one R2 bucket. The `*.workers.dev` URL is the LIFF endpoint for now; dev and production OAs differ only by the Worker vars (LIFF ID, channel ID, OA ID). A custom domain can be added later without code changes.
- Uploads go through the Worker, max 40 MB per file. Larger material is attached as an https link.
- The privacy notice text is written by me and shown in the app; the owner or a lawyer should review it before launch. Admin can export members as CSV and remove a learner's enrollment.
- Learner app is plain HTML/CSS/JS with the LIFF SDK. No build step.

## Contact menu (added 2026-11-11 after owner request; approved in chat)

The rich menu button 6 "ติดต่อเรา" opens the MINI App page `?p=contact` with **two** choices (owner cut it from three on 2026-11-11 because rich menu button 4 already opens the website):

1. **สอบถามคอร์สอบรม**: the website's quote-request form (ขอใบเสนอราคาอบรม) rebuilt as a **one-field-at-a-time wizard** so it never looks long. The owner asked for this explicitly. Steps: ชื่อองค์กร, หลักสูตรที่สนใจ, รูปแบบและความคาดหวัง, จำนวนผู้เรียน, อีเมลติดต่อ (prefilled from the member's registration email, my call), รายละเอียดเพิ่มเติม (optional, skippable), then a summary and "ส่งคำขอใบเสนอราคา". Same field rules, course list and expectation list as the website form (`index.html` #quote-form, `lib/contact-message.mjs`). Back button keeps answers; a draft survives leaving the page (sessionStorage).
2. **สอบถามบทเรียนที่เรียนไปแล้ว**: opens the OA chat (`https://line.me/R/oaMessage/%40<basic id>/?<text>`) with the text "สอบถามบทเรียนที่เรียนไปแล้ว" prefilled (my call).

My calls for option 2 (owner can override):
- The Worker validates the request with the website's rules, stores a copy in D1 (`inquiries`), then forwards it server-to-server to the existing website endpoint `https://innow.co.th/api/contact` (JSON; the endpoint already emails ask@innow.co.th through SES), so no AWS credentials are added to the Worker. The URL is a Worker var `INQUIRY_FORWARD_URL`; empty disables forwarding. A forward failure does not lose the request: the learner still sees success, the row is marked not forwarded, and the admin page shows it.
- Only signed-in LINE members who are friends of the OA can submit. Limit: 3 submissions per hour per learner (atomic, same pattern as the code limit).
- Admin gets a "คำขอใบเสนอราคา" tab (read-only list: time, organization, email, course, expectation, learners, details, member name, forwarded yes/no).
- Rich menu button 6 keeps the label "ติดต่อเรา" with the sublabel "สอบถามข้อมูล" (owner decision) and opens `?p=contact` instead of the OA chat directly.
- Rich menu button 4 label "ดูผลงานของเรา", sublabel "innow.co.th" (my call), with a simple portfolio/globe icon.
- Unverified: that the website's `/api/contact` is live and accepts server-side JSON posts from the Worker. To be checked at deploy.
