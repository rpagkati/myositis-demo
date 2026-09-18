"use strict";

// In-memory sliding-window limiter for the "send/resend sharing link" action,
// keyed per patient (not per IP — the thing being protected is email spam to
// a given PT, not raw request volume). Single-process only: a real multi-
// instance deployment should move this to a shared store (e.g. Redis)
// instead of a plain Map, or resends from a second instance won't see the
// first instance's counts.
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_SENDS_PER_WINDOW = Number(process.env.SHARING_LINK_MAX_SENDS_PER_HOUR || 3);

const sendTimestamps = new Map(); // patientId -> number[] (ms timestamps)

function pruneOld(timestamps, now) {
  return timestamps.filter((t) => now - t < WINDOW_MS);
}

// Returns {allowed, remaining, retryAfterSeconds} and, if allowed, records
// the send immediately (call this right before actually sending).
function checkAndRecordSend(patientId) {
  const now = Date.now();
  const existing = pruneOld(sendTimestamps.get(patientId) || [], now);

  if (existing.length >= MAX_SENDS_PER_WINDOW) {
    const oldest = existing[0];
    const retryAfterSeconds = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
    sendTimestamps.set(patientId, existing);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  existing.push(now);
  sendTimestamps.set(patientId, existing);
  return { allowed: true, remaining: MAX_SENDS_PER_WINDOW - existing.length, retryAfterSeconds: 0 };
}

function resetForTests() {
  sendTimestamps.clear();
}

module.exports = { checkAndRecordSend, resetForTests, MAX_SENDS_PER_WINDOW };
