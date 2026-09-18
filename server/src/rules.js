"use strict";
// Server-side port of the read-only subset of the rule engine from the
// frontend's index.html (see Rules.* there). Kept deliberately close to
// that implementation so the PT view shows the same alerts a clinician
// would see in the main app. Only read/display logic is ported here —
// nothing that mutates a patient's program (e.g. advanceProgression) has
// an equivalent on this side, because the PT view is read-only, full stop.
//
// This is manual duplication rather than a shared module, so the existing
// single-file frontend (index.html) can keep shipping as one dependency-free
// static file on GitHub Pages, unchanged. If the two ever drift, this file
// is the one to check against index.html's Rules object.

const CATEGORIES = ["Core", "Targeted", "Endurance", "Aerobic"];
const RECOVERY_LABELS = {
  under30: "Recovered < 30 min",
  between30and60: "Recovered 30–60 min",
  over60: "Recovered > 60 min",
  notRecovered: "Not recovered",
};
const IBM_DIAGNOSIS = "Inclusion Body Myositis (IBM)";
const IBMFRS_ITEMS = [
  { key: "item1", label: "Item 1", placeholder: "Swallowing" },
  { key: "item2", label: "Item 2", placeholder: "Handwriting" },
  { key: "item3", label: "Item 3", placeholder: "Cutting food" },
  { key: "item4", label: "Item 4", placeholder: "Handling utensils" },
  { key: "item5", label: "Item 5", placeholder: "Dressing" },
  { key: "item6", label: "Item 6", placeholder: "Hygiene" },
  { key: "item7", label: "Item 7", placeholder: "Bed mobility" },
  { key: "item8", label: "Item 8", placeholder: "Sit-to-stand" },
  { key: "item9", label: "Item 9", placeholder: "Walking" },
  { key: "item10", label: "Item 10", placeholder: "Stair climbing" },
];
const PROGRESSION_STEPS = {
  1: { startReps: 20, advanceAt: 30 },
  2: { startReps: 15, advanceAt: 25 },
  3: { startReps: 10, advanceAt: 20 },
  4: { repsRange: [10, 20] },
};

function parseISO(s) {
  const p = s.split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function daysBetween(s1, s2) {
  return Math.round((parseISO(s2) - parseISO(s1)) / 86400000);
}
function isIbmPatient(patient) {
  return patient.diagnosisSubtype === IBM_DIAGNOSIS;
}
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

const Rules = {};

Rules.gateCheck = function (patient) {
  if (!patient.clearedForExercise) {
    return { blocked: true, message: "Hold, not cleared.", reason: "Not cleared for exercise by physician." };
  }
  if (patient.inFlare) {
    return { blocked: true, message: "Hold, not cleared.", reason: "Currently in flare." };
  }
  return { blocked: false };
};

Rules.stopRegressionCheck = function (patient) {
  const logged = patient.dailyLogs.filter((l) => l.logged).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (logged.length < 3) return { triggered: false };
  const last3 = logged.slice(-3);
  const consecutiveCalendar = daysBetween(last3[0].date, last3[1].date) === 1 && daysBetween(last3[1].date, last3[2].date) === 1;
  const allHigh = last3.every((d) => (d.pain != null && d.pain >= 5) || (d.fatigue != null && d.fatigue >= 5));
  const mostRecent = last3[2];
  const recentFlags = mostRecent.progressive === true && mostRecent.adlImpact === true;
  if (consecutiveCalendar && allHigh && recentFlags) {
    return { triggered: true, message: "STOP — contact PT/physician immediately", days: last3 };
  }
  return { triggered: false };
};

Rules.missedLogCheck = function (patient) {
  const logged = patient.dailyLogs.filter((l) => l.logged).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!logged.length) return { shouldPrompt: false };
  const lastLog = logged[logged.length - 1];
  const todayISO = new Date().toISOString().slice(0, 10);
  const gap = daysBetween(lastLog.date, todayISO);
  if (gap < 3) return { shouldPrompt: false };
  let lastCompleted = null;
  for (let i = logged.length - 1; i >= 0; i--) {
    if (logged[i].completed) {
      lastCompleted = logged[i];
      break;
    }
  }
  return { shouldPrompt: true, daysSinceLastLog: gap, lastLogDate: lastLog.date, lastCompletedLog: lastCompleted };
};

Rules.checkinConcernFlag = function (entry) {
  return entry.afterSessionPain >= 5 || entry.afterSessionFatigue >= 5 || entry.currentPain >= 5 || entry.currentFatigue >= 5 || entry.concernNoted === true;
};

Rules.recoveryTimeFlags = function (patient) {
  const byDate = {};
  patient.dailyLogs.forEach((l) => {
    if (l.logged) byDate[l.date] = l;
  });
  const flagged = patient.dailyLogs.filter((l) => l.completed && (l.recovery === "over60" || l.recovery === "notRecovered"));
  return flagged.map((l) => {
    const d24 = addDaysISO(l.date, 1);
    const d48 = addDaysISO(l.date, 2);
    return { sessionDate: l.date, recovery: l.recovery, has24h: !!byDate[d24], date24: d24, has48h: !!byDate[d48], date48: d48 };
  });
};
function addDaysISO(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

Rules.progressionStatus = function (progression) {
  if (!progression) return null;
  const step = progression.step;
  if (step < 4) {
    const def = PROGRESSION_STEPS[step];
    return { step, readyToAdvance: progression.currentReps >= def.advanceAt, target: def.advanceAt, startReps: def.startReps, atCeiling: false };
  }
  const atCeiling = progression.currentWeight >= progression.ceiling && progression.currentSets >= 3;
  const readyToAddSet = progression.currentReps >= PROGRESSION_STEPS[4].repsRange[1] && progression.currentSets < 3;
  return { step: 4, readyToAdvance: readyToAddSet, atCeiling };
};

Rules.programCompositionAudit = function (patient) {
  return CATEGORIES.filter((cat) => !patient.program.some((e) => e.category === cat));
};

Rules.sessionSplitSuggestion = function (patient) {
  const recent = patient.dailyLogs
    .filter((l) => l.completed && l.rpe != null)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-10);
  if (recent.length < 3) return { suggest: false, avgRpe: null, count: recent.length };
  const mean = avg(recent.map((l) => l.rpe));
  return { suggest: mean > 5, avgRpe: mean, count: recent.length };
};

Rules.ibmfrsDeclineFlag = function (patient) {
  const entries = patient.fom.filter((f) => Array.isArray(f.ibmfrsItems)).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (entries.length < 2) return { triggered: false, hasData: entries.length > 0 };
  const prev = entries[entries.length - 2];
  const curr = entries[entries.length - 1];
  const delta = curr.ibmfrsTotal - prev.ibmfrsTotal;
  const result = { triggered: false, hasData: true, delta, previousTotal: prev.ibmfrsTotal, currentTotal: curr.ibmfrsTotal, previousDate: prev.date, currentDate: curr.date };
  if (delta <= -2) {
    result.triggered = true;
    result.message = `IBMFRS dropped by ${-delta} points since last visit — exceeds the published meaningful-decline threshold.`;
  }
  return result;
};

function fomMeasuresFor(patient) {
  const common = [
    { key: "gaitSpeed", label: "Gait speed (m/s)" },
    { key: "tug", label: "TUG (s)" },
    { key: "sts30", label: "30s-STS (reps)" },
    { key: "sts5x", label: "5x-STS (s)" },
    { key: "mwt2", label: "2MWT (m)" },
    { key: "mwt6", label: "6MWT (m)" },
  ];
  return isIbmPatient(patient) ? common.concat([{ key: "ibmfrsTotal", label: "IBMFRS Total (0–40, higher = better)" }]) : common.concat([{ key: "fi2", label: "FI-2 (score)" }, { key: "fi3", label: "FI-3 (score)" }]);
}

module.exports = {
  Rules,
  CATEGORIES,
  RECOVERY_LABELS,
  IBM_DIAGNOSIS,
  IBMFRS_ITEMS,
  PROGRESSION_STEPS,
  isIbmPatient,
  fomMeasuresFor,
  daysBetween,
  addDaysISO,
};
