import { TwitterApi } from 'twitter-api-v2';

const REQUIRED_X_ENV_VARS = [
  'X_API_KEY',
  'X_API_SECRET',
  'X_ACCESS_TOKEN',
  'X_ACCESS_SECRET',
] as const;

type XEnvVar = (typeof REQUIRED_X_ENV_VARS)[number];

export function missingXEnvVars(): XEnvVar[] {
  return REQUIRED_X_ENV_VARS.filter((key) => !process.env[key]) as XEnvVar[];
}

export function getXClient(): TwitterApi | null {
  const missing = missingXEnvVars();
  if (missing.length) {
    console.error(`X client not initialized. Missing env vars: ${missing.join(', ')}`);
    return null;
  }

  try {
    return new TwitterApi({
      appKey: process.env.X_API_KEY as string,
      appSecret: process.env.X_API_SECRET as string,
      accessToken: process.env.X_ACCESS_TOKEN as string,
      accessSecret: process.env.X_ACCESS_SECRET as string,
    });
  } catch (error) {
    console.error('Failed to initialize X client. Check your X API credentials.', error);
    return null;
  }
}
