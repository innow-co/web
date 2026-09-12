# Verification — 2026-09-12

- `node --check script.js`: passed.
- `node --check api/download.js`: passed.
- `node --test tests/download.test.js`: 8 passed, 0 failed. Email provider mocked; no real email sent.
- `git diff --check`: passed.
- Browser widths: 375, 390, 768, 1024, 1440. No horizontal content overflow.
- All currently displayed images decoded; no missing assets or invalid internal anchors.
- Clean browser run: no console/page errors or failed network responses.
- Course details open, close with Escape, and pass chosen course into the download form.
- Mobile navigation opens and closes on selection.
- Carousel advances; finance filter shows 4 entries when expanded; all filter shows 11 source entries (GH Bank IT and Audit counted separately).
- Exactly five required contact inputs; blank, invalid email and invalid phone are rejected.
- Local preview downloads `innow-company-profile-2026.pptx`; status explicitly states that contact data was not sent.
- Production email delivery remains unverified and requires recipient, verified sender and Resend API key.
