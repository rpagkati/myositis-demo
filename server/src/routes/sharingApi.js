"use strict";
const express = require("express");
const { getDb } = require("../db");
const repo = require("../repo");
const { generateToken, redactToken } = require("../tokens");
const { checkAndRecordSend } = require("../rateLimit");
const { sendSharingLinkEmail } = require("../email");

const router = express.Router();
const TTL_DAYS = Number(process.env.SHARING_LINK_TTL_DAYS || 90);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SECURITY NOTE (read this before deploying anywhere beyond a demo):
// The rest of this app has no login system — a patient is just a name
// picked from a dropdown in the frontend. These endpoints inherit that: they
// trust whatever :patientId is in the URL with no verification that the
// caller actually IS that patient. That's acceptable for a local, seeded,
// no-PHI pilot demo; it is NOT acceptable once this handles real patients.
// Add real patient authentication (session or token-based) and check it
// here before this goes anywhere near production data.

function requirePatient(req, res, next) {
  const db = getDb();
  const patient = repo.getPatientFull(db, req.params.patientId);
  if (!patient) return res.status(404).json({ error: "Patient not found." });
  req.patient = patient;
  req.db = db;
  next();
}

function buildLink(token) {
  const base = process.env.PUBLIC_BASE_URL || "http://localhost:3001";
  return `${base.replace(/\/$/, "")}/pt-view/${token}`;
}

function linkPublicView(link) {
  if (!link) return { status: "none" };
  return {
    status: repo.linkStatus(link),
    ptName: link.pt_name,
    ptEmail: link.pt_email,
    // Only the patient's own status endpoint returns this — it's their own
    // link, shown back to them (e.g. so they can copy it), not a leak.
    url: link.token ? buildLink(link.token) : null,
    createdAt: link.created_at,
    expiresAt: link.expires_at,
    lastAccessedAt: link.last_accessed_at,
    accessCount: link.access_count,
  };
}

router.get("/patients/:patientId/sharing/status", requirePatient, (req, res) => {
  const link = repo.getLatestLinkForPatient(req.db, req.patient.id);
  res.json({ sharingEnabled: req.patient.sharingEnabled, link: linkPublicView(link) });
});

router.post("/patients/:patientId/sharing/enable", requirePatient, async (req, res) => {
  const { ptName, ptEmail } = req.body || {};
  if (!ptName || typeof ptName !== "string" || !ptName.trim()) {
    return res.status(400).json({ error: "ptName is required." });
  }
  if (!ptEmail || typeof ptEmail !== "string" || !EMAIL_RE.test(ptEmail.trim())) {
    return res.status(400).json({ error: "A valid ptEmail is required." });
  }

  const rate = checkAndRecordSend(req.patient.id);
  if (!rate.allowed) {
    res.set("Retry-After", String(rate.retryAfterSeconds));
    return res.status(429).json({ error: "Too many sharing-link emails sent recently. Please try again later.", retryAfterSeconds: rate.retryAfterSeconds });
  }

  // One active link per patient at a time: turning sharing on replaces
  // whatever link (if any) existed before, rather than accumulating them.
  repo.revokeActiveLinksForPatient(req.db, req.patient.id);
  const token = generateToken();
  const link = repo.createSharingLink(req.db, { token, patientId: req.patient.id, ptEmail: ptEmail.trim(), ptName: ptName.trim(), ttlDays: TTL_DAYS });
  repo.setPatientSharingEnabled(req.db, req.patient.id, true);

  const emailResult = await sendSharingLinkEmail({ ptEmail: link.ptEmail, ptName: link.ptName, patientName: req.patient.name, link: buildLink(token), token });
  console.log(`[sharing] Enabled + link created for patient ${req.patient.id}, token ${redactToken(token)}, email ${emailResult.mode}`);

  res.json({ sharingEnabled: true, link: linkPublicView({ ...toRow(link), revoked: 0, access_count: 0, last_accessed_at: null }), emailSent: emailResult.sent, emailMode: emailResult.mode });
});

router.post("/patients/:patientId/sharing/disable", requirePatient, (req, res) => {
  repo.revokeActiveLinksForPatient(req.db, req.patient.id);
  repo.setPatientSharingEnabled(req.db, req.patient.id, false);
  console.log(`[sharing] Disabled + revoked link(s) for patient ${req.patient.id}`);
  res.json({ sharingEnabled: false });
});

router.post("/patients/:patientId/sharing/revoke", requirePatient, (req, res) => {
  repo.revokeActiveLinksForPatient(req.db, req.patient.id);
  console.log(`[sharing] Link revoked (access toggle left on) for patient ${req.patient.id}`);
  const link = repo.getLatestLinkForPatient(req.db, req.patient.id);
  res.json({ link: linkPublicView(link) });
});

router.post("/patients/:patientId/sharing/resend", requirePatient, async (req, res) => {
  const existing = repo.getLatestLinkForPatient(req.db, req.patient.id);
  const status = repo.linkStatus(existing);

  const rate = checkAndRecordSend(req.patient.id);
  if (!rate.allowed) {
    res.set("Retry-After", String(rate.retryAfterSeconds));
    return res.status(429).json({ error: "Too many sharing-link emails sent recently. Please try again later.", retryAfterSeconds: rate.retryAfterSeconds });
  }

  let token, link;
  if (status === "active") {
    // Resend the SAME still-valid link rather than minting a new one.
    token = existing.token;
    link = existing;
  } else {
    const { ptName, ptEmail } = req.body || {};
    if (!ptName || !ptEmail || !EMAIL_RE.test(String(ptEmail).trim())) {
      return res.status(400).json({ error: "No active link to resend; provide ptName and ptEmail to create one." });
    }
    repo.revokeActiveLinksForPatient(req.db, req.patient.id);
    token = generateToken();
    const created = repo.createSharingLink(req.db, { token, patientId: req.patient.id, ptEmail: ptEmail.trim(), ptName: ptName.trim(), ttlDays: TTL_DAYS });
    repo.setPatientSharingEnabled(req.db, req.patient.id, true);
    link = toRow(created);
  }

  const emailResult = await sendSharingLinkEmail({ ptEmail: link.pt_email || link.ptEmail, ptName: link.pt_name || link.ptName, patientName: req.patient.name, link: buildLink(token), token });
  console.log(`[sharing] Resent link for patient ${req.patient.id}, token ${redactToken(token)}, email ${emailResult.mode}`);

  const refreshed = repo.getLatestLinkForPatient(req.db, req.patient.id);
  res.json({ link: linkPublicView(refreshed), emailSent: emailResult.sent, emailMode: emailResult.mode });
});

function toRow(link) {
  return { pt_email: link.ptEmail, pt_name: link.ptName, created_at: link.createdAt, expires_at: link.expiresAt, revoked: link.revoked ? 1 : 0, last_accessed_at: link.lastAccessedAt, access_count: link.accessCount };
}

module.exports = router;
