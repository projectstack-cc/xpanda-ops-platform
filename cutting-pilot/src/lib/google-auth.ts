// src/lib/google-auth.ts
// Exchanges a stored OAuth refresh token for a short-lived access token.
// Service-account keys are blocked by org policy (iam.disableServiceAccountKeyCreation),
// so the schedule poller authenticates as a real xpandafoam.com user via user OAuth instead.

export interface GoogleAuthEnv {
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_OAUTH_REFRESH_TOKEN: string;
}

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export async function getAccessToken(env: GoogleAuthEnv): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${text}`);
  }

  let data: { access_token?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Google OAuth token refresh returned non-JSON body: ${text}`);
  }

  if (!data.access_token) {
    throw new Error(`Google OAuth token refresh response had no access_token: ${text}`);
  }

  return data.access_token;
}
