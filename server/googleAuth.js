// server/googleAuth.js
// Verifies Google Identity Services ID tokens sent from the client after
// "Sign in with Google" (see public/js/login.js). The client only ever
// hands the server an opaque signed token -- it never gets to assert its
// own email/name/id, so a malicious client can't spoof who it is the same
// way it can't spoof a socket's identity (see server.js's io.use handshake
// comment). Google's own library validates signature, issuer, audience,
// and expiry; we just extract the fields we trust afterward.
const { OAuth2Client } = require("google-auth-library");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

if (!GOOGLE_CLIENT_ID) {
  console.warn(
    "[googleAuth] GOOGLE_CLIENT_ID not set — the 'Sign in with Google' button will render " +
    "client-side but every /auth/google request will be rejected server-side. Set " +
    "GOOGLE_CLIENT_ID (same value as the client-side data-client_id) before relying on it."
  );
}

// Resolves to { googleId, email, emailVerified, name } or throws on an
// invalid/expired/wrong-audience token -- callers should catch and return a
// generic 400, never echo the raw error message to the client.
async function verifyGoogleIdToken(idToken) {
  if (!client) throw new Error("Google Sign-In is not configured on this server");
  if (!idToken || typeof idToken !== "string") throw new Error("Missing Google credential");

  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error("Invalid Google credential payload");
  }

  return {
    googleId: payload.sub,
    email: String(payload.email).trim().toLowerCase(),
    emailVerified: !!payload.email_verified,
    name: payload.name || null,
  };
}

module.exports = { verifyGoogleIdToken, GOOGLE_CLIENT_ID };
