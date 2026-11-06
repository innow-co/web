import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';
import { makeMessage } from '../lib/contact-message.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.body?.website) return res.status(200).json({ ok: true });
  let message;
  try { message = makeMessage(req.body); }
  catch { return res.status(400).json({ error: 'Invalid form data' }); }
  if (!process.env.AWS_ROLE_ARN) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const client = new SESv2Client({ region: 'ap-southeast-2', credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) });
    await client.send(new SendEmailCommand(message));
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ error: 'Service unavailable' });
  }
}
