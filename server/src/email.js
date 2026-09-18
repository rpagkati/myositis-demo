"use strict";
const { redactToken } = require("./tokens");

// Talks to Postmark's HTTP API directly (no SDK dependency) so it's easy to
// swap for SendGrid/SES later — the only thing routes.js depends on is the
// sendSharingLinkEmail(...) function signature below.
//
// Without POSTMARK_API_TOKEN set, this falls back to logging what WOULD be
// sent (never the raw token — see tokens.redactToken) so the sharing flow
// stays fully testable/demoable without a real email account. This is the
// intended state for this reference implementation until a real API key is
// configured; wire one in before relying on this for real notifications.
async function sendSharingLinkEmail({ ptEmail, ptName, patientName, link, token }) {
  const apiToken = process.env.POSTMARK_API_TOKEN;
  const fromEmail = process.env.POSTMARK_FROM_EMAIL || "no-reply@example.org";

  const subject = `${patientName} shared their Myositis Home Companion progress with you`;
  const textBody =
    `Hi ${ptName},\n\n` +
    `${patientName} has given you view access to their exercise program, daily logs, and functional outcome measures in the Myositis Home Companion app.\n\n` +
    `View it here: ${link}\n\n` +
    `This link does not require a login. It will stop working automatically in 90 days, or sooner if ${patientName} revokes access.\n\n` +
    `This is a demo/research-pilot system. Do not use it for real patient data.`;

  if (!apiToken) {
    console.log(
      `[email:dev-mode] Would send sharing-link email to ${maskEmail(ptEmail)} ` +
        `for token ${redactToken(token)}. Set POSTMARK_API_TOKEN to actually send mail.`
    );
    return { sent: false, mode: "dev-log" };
  }

  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": apiToken,
      },
      body: JSON.stringify({
        From: fromEmail,
        To: ptEmail,
        Subject: subject,
        TextBody: textBody,
        MessageStream: "outbound",
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Postmark send failed (${res.status}) for token ${redactToken(token)}: ${detail.slice(0, 200)}`);
      return { sent: false, mode: "error" };
    }
    return { sent: true, mode: "postmark" };
  } catch (err) {
    console.error(`[email] Postmark send threw for token ${redactToken(token)}: ${err.message}`);
    return { sent: false, mode: "error" };
  }
}

function maskEmail(email) {
  const at = email.indexOf("@");
  if (at <= 1) return "***" + email.slice(at);
  return email[0] + "***" + email.slice(at - 1);
}

module.exports = { sendSharingLinkEmail };
