// server/mailer.js
// Thin SendGrid wrapper for transactional emails (password-reset codes).
// If SENDGRID_API_KEY isn't set (e.g. local dev before you've configured
// it), this falls back to logging the code to the server console instead
// of failing -- so `npm start` still works end-to-end on a fresh checkout
// without any SendGrid setup.
const sgMail = require("@sendgrid/mail");

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL || "no-reply@example.com";
const devMode = !apiKey;

if (apiKey) {
  sgMail.setApiKey(apiKey);
} else {
  console.warn(
    "[mailer] SENDGRID_API_KEY not set — reset codes will be printed to this console instead of emailed. " +
    "Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL before deploying."
  );
}

async function sendPasswordResetEmail(toEmail, code) {
  if (devMode) {
    console.log(`[mailer:DEV] Password reset code for ${toEmail} is ${code} (would be emailed via SendGrid in production)`);
    return { dev: true };
  }

  const msg = {
    to: toEmail,
    from: fromEmail,
    subject: `${code} is your Game of the Generals password reset code`,
    text: `Your password reset code is ${code}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email -- your password hasn't changed.`,
    html: `<p>Your password reset code is <strong style="font-size:1.2em;letter-spacing:2px;">${code}</strong>.</p>` +
      `<p>It expires in 10 minutes. If you didn't request this, you can safely ignore this email -- your password hasn't changed.</p>`,
  };

  try {
    await sgMail.send(msg);
    return { dev: false };
  } catch (err) {
    const detail = err?.response?.body ? JSON.stringify(err.response.body) : err.message;
    console.error(`[mailer] SendGrid send failed for ${toEmail}: ${detail}`);
    throw new Error("Failed to send email");
  }
}

module.exports = { sendPasswordResetEmail, devMode };
