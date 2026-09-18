"use strict";

function rowToBool(v) {
  return !!v;
}

function getPatientFull(db, patientId) {
  const p = db.prepare("SELECT * FROM patients WHERE id = ?").get(patientId);
  if (!p) return null;

  const exercises = db.prepare("SELECT * FROM program_exercises WHERE patient_id = ?").all(patientId);
  const logs = db.prepare("SELECT * FROM daily_logs WHERE patient_id = ? ORDER BY date ASC").all(patientId);
  const fom = db.prepare("SELECT * FROM fom_entries WHERE patient_id = ? ORDER BY date ASC").all(patientId);
  const mmt = db.prepare("SELECT * FROM mmt_entries WHERE patient_id = ? ORDER BY date ASC").all(patientId);

  return {
    id: p.id,
    name: p.name,
    diagnosisSubtype: p.diagnosis_subtype,
    sessionsPerWeek: p.sessions_per_week,
    targetRPE: { min: p.target_rpe_min, max: p.target_rpe_max },
    clearedForExercise: rowToBool(p.cleared_for_exercise),
    inFlare: rowToBool(p.in_flare),
    sharingEnabled: rowToBool(p.sharing_enabled),
    localPtName: p.local_pt_name,
    program: exercises.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      prescription: e.prescription,
      progression: e.progression_json ? JSON.parse(e.progression_json) : null,
      history: JSON.parse(e.history_json || "[]"),
    })),
    dailyLogs: logs.map((l) => ({
      date: l.date,
      logged: rowToBool(l.logged),
      completed: rowToBool(l.completed),
      rpe: l.rpe,
      pain: l.pain,
      fatigue: l.fatigue,
      recovery: l.recovery,
      progressive: l.progressive == null ? null : rowToBool(l.progressive),
      adlImpact: l.adl_impact == null ? null : rowToBool(l.adl_impact),
      note: l.note,
    })),
    fom: fom.map((f) => ({
      date: f.date,
      gaitSpeed: f.gait_speed,
      tug: f.tug,
      sts30: f.sts30,
      sts5x: f.sts5x,
      mwt2: f.mwt2,
      mwt6: f.mwt6,
      fi2: f.fi2,
      fi3: f.fi3,
      ibmfrsItems: f.ibmfrs_items_json ? JSON.parse(f.ibmfrs_items_json) : undefined,
      ibmfrsTotal: f.ibmfrs_total == null ? undefined : f.ibmfrs_total,
    })),
    mmt: mmt.map((m) => ({
      date: m.date,
      hipFlexors: m.hip_flexors,
      kneeExtensors: m.knee_extensors,
      shoulderAbductors: m.shoulder_abductors,
      ankleDorsiflexors: m.ankle_dorsiflexors,
    })),
  };
}

function setPatientSharingEnabled(db, patientId, enabled) {
  db.prepare("UPDATE patients SET sharing_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, patientId);
}

function createSharingLink(db, { token, patientId, ptEmail, ptName, ttlDays }) {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sharing_links (token, patient_id, pt_email, pt_name, created_at, expires_at, revoked, access_count)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
  ).run(token, patientId, ptEmail, ptName, createdAt, expiresAt);
  return { token, patientId, ptEmail, ptName, createdAt, expiresAt, revoked: false, lastAccessedAt: null, accessCount: 0 };
}

function revokeActiveLinksForPatient(db, patientId) {
  db.prepare("UPDATE sharing_links SET revoked = 1 WHERE patient_id = ? AND revoked = 0").run(patientId);
}

function getLatestLinkForPatient(db, patientId) {
  return db
    .prepare("SELECT * FROM sharing_links WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(patientId);
}

function findLinkByToken(db, token) {
  return db.prepare("SELECT * FROM sharing_links WHERE token = ?").get(token);
}

function recordLinkAccess(db, token) {
  db.prepare(
    "UPDATE sharing_links SET access_count = access_count + 1, last_accessed_at = ? WHERE token = ?"
  ).run(new Date().toISOString(), token);
}

function linkStatus(link) {
  if (!link) return "none";
  if (link.revoked) return "revoked";
  if (new Date(link.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

module.exports = {
  getPatientFull,
  setPatientSharingEnabled,
  createSharingLink,
  revokeActiveLinksForPatient,
  getLatestLinkForPatient,
  findLinkByToken,
  recordLinkAccess,
  linkStatus,
};
