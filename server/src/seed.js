"use strict";
const { addDaysISO } = require("./rules");
const { generateToken, redactToken } = require("./tokens");

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isSeeded(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM patients").get();
  return row.n > 0;
}

// Mirrors the frontend's demo patients (index.html buildSeedData) closely
// enough for the read-only PT view to demonstrate the same alerts, plus one
// active, previously-accessed SharingLink (Jordan Blake) so the whole
// magic-link flow is demonstrable without any manual setup.
function seed(db) {
  if (isSeeded(db)) return;
  const today = todayISO();

  const insertPatient = db.prepare(
    `INSERT INTO patients (id, name, diagnosis_subtype, sessions_per_week, target_rpe_min, target_rpe_max, cleared_for_exercise, in_flare, sharing_enabled, local_pt_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertExercise = db.prepare(
    `INSERT INTO program_exercises (id, patient_id, name, category, prescription, progression_json, history_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertLog = db.prepare(
    `INSERT INTO daily_logs (patient_id, date, logged, completed, rpe, pain, fatigue, recovery, progressive, adl_impact, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFom = db.prepare(
    `INSERT INTO fom_entries (patient_id, date, gait_speed, tug, sts30, sts5x, mwt2, mwt6, fi2, fi3, ibmfrs_items_json, ibmfrs_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMmt = db.prepare(
    `INSERT INTO mmt_entries (patient_id, date, hip_flexors, knee_extensors, shoulder_abductors, ankle_dorsiflexors)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertLink = db.prepare(
    `INSERT INTO sharing_links (token, patient_id, pt_email, pt_name, created_at, expires_at, revoked, last_accessed_at, access_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // ---- Patient A: normal / steady case ----
  insertPatient.run("p1", "Alex Rivera", "Polymyositis (PM)", 3, 3, 5, 1, 0, 1, "Dana Kim, PT");
  insertExercise.run("p1-ex1", "p1", "Sit-to-Stand", "Core", "2 sets x 10 reps", null, "[]");
  insertExercise.run(
    "p1-ex2",
    "p1",
    "Standing Hip Abduction",
    "Targeted",
    "Weighted progression — see progression tracker",
    JSON.stringify({ step: 2, currentWeight: 3, currentReps: 25, currentSets: 1, ceiling: 8 }),
    "[]"
  );
  insertExercise.run("p1-ex3", "p1", "Seated Marching", "Endurance", "3 sets x 60 seconds", null, "[]");
  insertExercise.run("p1-ex4", "p1", "Stationary Cycling", "Aerobic", "10 minutes, low resistance, RPE 3-5", null, "[]");
  for (let i = 14; i >= 0; i -= 2) {
    insertLog.run("p1", addDaysISO(today, -i), 1, 1, 4, 2, 2, "under30", 0, 0, "");
  }
  insertFom.run("p1", addDaysISO(today, -28), 0.8, 12.8, 7, 16.1, 120, 305, 14, 11, null, null);
  insertFom.run("p1", addDaysISO(today, -2), 0.9, 11.5, 8, 14.6, 130, 325, 16, 12, null, null);
  insertMmt.run("p1", addDaysISO(today, -2), 4, 4, 4.5, 4.5);

  // ---- Patient B: stop/regression case — ALSO the sharing-link demo patient ----
  insertPatient.run("p2", "Jordan Blake", "Dermatomyositis (DM)", 3, 3, 5, 1, 0, 1, "Dana Kim, PT");
  insertExercise.run("p2-ex1", "p2", "Modified Plank", "Core", "2 sets x 20 seconds hold", null, "[]");
  insertExercise.run(
    "p2-ex2",
    "p2",
    "Shoulder Flexion Raise",
    "Targeted",
    "Weighted progression — see progression tracker",
    JSON.stringify({ step: 1, currentWeight: 2, currentReps: 18, currentSets: 1, ceiling: 6 }),
    "[]"
  );
  insertExercise.run("p2-ex3", "p2", "Seated Ankle Pumps", "Endurance", "3 sets x 45 seconds", null, "[]");
  insertExercise.run("p2-ex4", "p2", "Supported Treadmill Walking", "Aerobic", "8 minutes level walking, rail support available", null, "[]");
  for (let j = 10; j >= 4; j--) {
    insertLog.run("p2", addDaysISO(today, -j), 1, 1, 5, 3, 3, "under30", 0, 0, "");
  }
  insertLog.run("p2", addDaysISO(today, -2), 1, 1, 7, 5, 6, "notRecovered", 1, 0, "Pain lingered through the evening.");
  insertLog.run("p2", addDaysISO(today, -1), 1, 1, 8, 6, 6, "notRecovered", 1, 1, "Pain is worse than yesterday, not improving.");
  insertLog.run("p2", today, 1, 1, 8, 7, 7, "notRecovered", 1, 1, "Struggling with stairs and dressing today.");
  insertFom.run("p2", addDaysISO(today, -40), 0.65, 15.8, 5, 20.2, 95, 250, 10, 8, null, null);
  insertMmt.run("p2", addDaysISO(today, -40), 3, 3, 3.5, 3.5);

  // Active, previously-accessed sharing link — demonstrates the full flow
  // (created a while ago, the PT has actually opened it more than once).
  const linkToken = generateToken();
  insertLink.run(
    linkToken,
    "p2",
    "dana.kim@example-clinic.org",
    "Dana Kim, PT",
    addDaysISO(today, -12),
    addDaysISO(today, 78), // 90 days from creation
    0,
    addDaysISO(today, -1),
    4
  );
  // Never log the raw token (see tokens.redactToken) — even in a demo seed
  // script. To actually follow the link locally, call
  // GET /api/patients/p2/sharing/status, which legitimately returns it as
  // API data (that's a normal authenticated-in-spirit response, not a log).
  console.log(`[seed] Demo sharing link created for Jordan Blake (p2), token ${redactToken(linkToken)}. Fetch GET /api/patients/p2/sharing/status for the full link.`);

  // ---- Patient C: missed-log case (sharing off) ----
  insertPatient.run("p3", "Sam Okafor", "Anti-synthetase syndrome", 2, 2, 4, 1, 0, 0, "Marcus Ellis, PT");
  insertExercise.run("p3-ex1", "p3", "Bridging", "Core", "2 sets x 12 reps", null, "[]");
  insertExercise.run("p3-ex2", "p3", "Straight Leg Raise", "Targeted", "2 sets x 10 reps each leg", null, "[]");
  insertLog.run("p3", addDaysISO(today, -5), 1, 1, 4, 3, 4, "between30and60", 0, 0, "Fine, just tired.");
  insertFom.run("p3", addDaysISO(today, -30), 0.6, 16.5, 4, 22.0, 85, 230, 9, 7, null, null);
  insertMmt.run("p3", addDaysISO(today, -30), 2.5, 3, 3, 3);

  // ---- Patient D: IBM case ----
  insertPatient.run("p4", "Priya Nair", "Inclusion Body Myositis (IBM)", 2, 2, 4, 1, 0, 1, "Dana Kim, PT");
  insertExercise.run("p4-ex1", "p4", "Modified Plank", "Core", "2 sets x 15 seconds hold", null, "[]");
  insertExercise.run("p4-ex2", "p4", "Sit-to-Stand", "Targeted", "2 sets x 8 reps, hands on chair arms as needed", null, "[]");
  insertExercise.run("p4-ex3", "p4", "Seated Marching", "Endurance", "2 sets x 45 seconds, moderate pace", null, "[]");
  insertExercise.run("p4-ex4", "p4", "Stationary Cycling", "Aerobic", "8 minutes, low resistance, RPE 2-4", null, "[]");
  const ibmVisits = [
    { d: -90, items: [4, 4, 4, 4, 3, 3, 3, 3, 3, 2] },
    { d: -45, items: [4, 4, 4, 3, 3, 3, 2, 2, 2, 1] },
    { d: -7, items: [4, 4, 3, 3, 3, 3, 2, 1, 1, 1] },
  ];
  ibmVisits.forEach((v) => {
    const total = v.items.reduce((a, b) => a + b, 0);
    insertFom.run("p4", addDaysISO(today, v.d), null, null, null, null, null, null, null, null, JSON.stringify(v.items), total);
  });
  insertMmt.run("p4", addDaysISO(today, -7), 2.5, 1.5, 4, 3.5);
}

module.exports = { seed, isSeeded };
