export function credentialsFromEnvironment(env) {
  if (!env.SES_ACCESS_KEY_ID || !env.SES_SECRET_ACCESS_KEY) return null;
  return { accessKeyId: env.SES_ACCESS_KEY_ID, secretAccessKey: env.SES_SECRET_ACCESS_KEY };
}
