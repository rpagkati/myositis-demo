"use strict";
const crypto = require("crypto");

// Cryptographically secure, unguessable, and carries no information derived
// from patient data (name, id, date, etc). 32 bytes = 256 bits of entropy.
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// For logs only: never write the raw token to server logs. This gives just
// enough to correlate log lines with a specific link during debugging,
// without the value itself being usable to access anything.
function redactToken(token) {
  if (!token) return "(none)";
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return token.slice(0, 6) + "…" + hash.slice(0, 8);
}

module.exports = { generateToken, redactToken };
