# Innow website

A complete static redesign based only on the three user-supplied source files. Local Thai fonts, real images and client logos extracted from the supplied PowerPoint; no external image or font requests.

## Preview

Run `python3 -m http.server 4173 --bind 127.0.0.1`, then open http://127.0.0.1:4173.

On localhost, the five-field form validates and downloads the original Company Profile without transmitting or storing personal information. The form explicitly identifies this preview behavior.

## Email delivery on Vercel

`api/download.js` sends the five contact fields to the owner via Resend, then the browser downloads the original PPTX. Set server-only environment variables in the existing Vercel project:

- `RESEND_API_KEY`: email sending credential.
- `LEAD_RECIPIENT_EMAIL`: confirmed recipient provided by the owner.
- `LEAD_FROM_EMAIL`: sender on a verified email domain.

No live email has been sent during development. Missing configuration, invalid input and provider failure return explicit errors, never a simulated success. The public form is a lead collection flow, not access control: the company profile is a public static asset. For heavy public traffic, apply deployment-level bot and rate protection.

The source files contain no verified contact address; deployment configuration is intentionally left empty until supplied. API behavior was implemented using the [Resend email API](https://resend.com/docs/api-reference/emails/send-email). No third-party mail service is activated automatically.

## Validation

`node --check script.js`

`node --test tests/download.test.js`

Desktop/mobile browser checks cover navigation, course dialogs, filters, carousel, all five fields, validation and local download. Production email delivery requires the above configuration and a separate real delivery check.
