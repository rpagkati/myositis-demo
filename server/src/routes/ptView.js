"use strict";
const express = require("express");
const { getDb } = require("../db");
const repo = require("../repo");
const { redactToken } = require("../tokens");
const { renderInactiveLinkPage, renderPatientDashboard } = require("../renderPtView");

const router = express.Router();

// No login required, by design — this is the whole point of a magic link.
// Validate-then-render happens in one place so there is exactly one point
// that decides what a given token is allowed to see.
router.get("/pt-view/:token", (req, res) => {
  const { token } = req.params;
  const db = getDb();
  const link = repo.findLinkByToken(db, token);
  const status = repo.linkStatus(link);

  if (status !== "active") {
    // Never log the raw token — only a truncated/hashed form.
    console.log(`[pt-view] Rejected access for token ${redactToken(token)} (status: ${status})`);
    const httpStatus = status === "none" ? 404 : 410;
    return res.status(httpStatus).send(renderInactiveLinkPage());
  }

  const patient = repo.getPatientFull(db, link.patient_id);
  if (!patient) {
    console.error(`[pt-view] Link ${redactToken(token)} points at a missing patient`);
    return res.status(410).send(renderInactiveLinkPage());
  }

  // Audit trail: every successful view updates lastAccessedAt/accessCount.
  repo.recordLinkAccess(db, token);
  console.log(`[pt-view] Served read-only view for token ${redactToken(token)}`);

  res.set("Cache-Control", "no-store"); // this page contains patient data; never let a shared/browser cache keep a copy
  res.send(renderPatientDashboard(patient));
});

module.exports = router;
