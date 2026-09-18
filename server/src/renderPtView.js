"use strict";
const { Rules, RECOVERY_LABELS, isIbmPatient, fomMeasuresFor, IBMFRS_ITEMS } = require("./rules");

const BASE_STYLE = `
  :root{--bg:#f2f5f8;--surface:#fff;--text:#1c2530;--muted:#5b6b7b;--border:#dbe3ea;
    --primary:#2563a6;--primary-dark:#194673;--primary-bg:#e8f0fa;
    --success:#1f8a55;--success-bg:#e7f6ee;--warning:#9a6b00;--warning-bg:#fff6df;
    --danger:#b3241c;--danger-bg:#fdeceb;--radius:10px;--shadow:0 1px 3px rgba(20,30,40,.08);}
  *{box-sizing:border-box;}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.4;}
  #banner{background:#7a1f1f;color:#fff;padding:9px 16px;font-size:13px;text-align:center;font-weight:600;}
  header{background:var(--surface);border-bottom:1px solid var(--border);padding:14px 20px;box-shadow:var(--shadow);}
  header h1{font-size:16px;margin:0 0 2px;color:var(--primary-dark);}
  main{max-width:900px;margin:0 auto;padding:18px 16px 60px;}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px;box-shadow:var(--shadow);}
  .card h2{margin:0 0 10px;font-size:15px;}
  .muted{color:var(--muted);font-size:12.5px;}
  table{width:100%;border-collapse:collapse;font-size:12.5px;}
  table th,table td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);}
  table th{color:var(--muted);font-weight:600;font-size:11.5px;text-transform:uppercase;}
  .alert{border-radius:8px;padding:11px 13px;margin-bottom:10px;font-size:13px;}
  .alert h4{margin:0 0 4px;font-size:13px;}
  .alert-danger{background:var(--danger-bg);color:var(--danger);}
  .alert-warning{background:var(--warning-bg);color:var(--warning);}
  .alert-info{background:var(--primary-bg);color:var(--primary-dark);}
  .alert-success{background:var(--success-bg);color:var(--success);}
  .pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;}
  .pill-core{background:#e8f0fa;color:#2563a6;} .pill-targeted{background:#f4e8fa;color:#7a2ea6;}
  .pill-endurance{background:#fff1e0;color:#b06a00;} .pill-aerobic{background:#e7f6ee;color:#1f8a55;}
  .stop-banner{background:var(--danger);color:#fff;padding:16px;border-radius:var(--radius);font-size:15px;font-weight:700;text-align:center;margin-bottom:14px;}
  .exercise-item{border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;}
  .exercise-item .head{display:flex;justify-content:space-between;align-items:center;}
  .readonly-note{display:inline-block;font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:12px;padding:2px 10px;margin-left:8px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;}
  .ibmfrs-item{border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center;}
  .ibmfrs-item .item-label{font-size:11px;color:var(--muted);margin-bottom:4px;min-height:26px;}
`;

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function daysBetween(s1, s2) {
  const p = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  return Math.round((p(s2) - p(s1)) / 86400000);
}

function svgSparkline(points, opts) {
  opts = opts || {};
  const w = opts.width || 120, h = opts.height || 34, color = opts.color || "#2563a6";
  const yMin = opts.yMin != null ? opts.yMin : 0, yMax = opts.yMax != null ? opts.yMax : 4;
  if (!points.length) return '<div class="muted" style="font-size:11px;">No data</div>';
  const pts = points.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const minDate = pts[0].date, maxDate = pts[pts.length - 1].date;
  const span = daysBetween(minDate, maxDate) || 1;
  const x = (d) => 4 + (daysBetween(minDate, d) / span) * (w - 8);
  const y = (v) => h - 4 - ((v - yMin) / (yMax - yMin || 1)) * (h - 8);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + x(p.date).toFixed(1) + "," + y(p.value).toFixed(1)).join(" ");
  const circles = pts.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.2" fill="${color}"><title>${fmtDate(p.date)}: ${p.value}</title></circle>`).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.6"/>${circles}</svg>`;
}

function pageShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title><style>${BASE_STYLE}</style></head>
<body>${bodyHtml}</body></html>`;
}

// Shown when a token is missing, expired, or revoked. Deliberately does NOT
// say which of those it is (avoids confirming to an attacker that a token
// once existed) beyond the one clear, patient-friendly message the spec asks for.
function renderInactiveLinkPage() {
  return pageShell(
    "Link no longer active — Myositis Home Companion",
    `<div id="banner"><strong>Research Prototype</strong> — Seeded demo data only. Not connected to any real EHR or PHI.</div>
    <main style="max-width:520px;">
      <div class="card" style="text-align:center;margin-top:40px;">
        <h2>This link is no longer active</h2>
        <p class="muted">Please ask your patient to resend it from their Sharing settings.</p>
      </div>
    </main>`
  );
}

function renderAlerts(p) {
  let html = '<div class="card"><h2>Alerts</h2>';
  const gate = Rules.gateCheck(p);
  html += gate.blocked
    ? `<div class="alert alert-warning"><h4>Gate check: ${gate.message}</h4>${gate.reason}</div>`
    : `<div class="alert alert-success"><h4>Gate check: cleared</h4>Patient is cleared for exercise and not currently in flare.</div>`;

  const stop = Rules.stopRegressionCheck(p);
  html += stop.triggered
    ? `<div class="stop-banner">⛔ ${stop.message}<div style="font-weight:500;font-size:12.5px;margin-top:4px;">3 consecutive logged days with pain or fatigue ≥5, and today's log shows progressive symptoms with ADL impact.</div></div>`
    : `<div class="alert alert-success"><h4>Stop/regression: not triggered</h4>No qualifying 3-day pattern detected.</div>`;

  const missed = Rules.missedLogCheck(p);
  html += missed.shouldPrompt
    ? `<div class="alert alert-warning"><h4>Missed-log check-in pending</h4>No log in ${missed.daysSinceLastLog} days (since ${fmtDate(missed.lastLogDate)}).</div>`
    : `<div class="alert alert-success"><h4>Logging: up to date</h4></div>`;

  const recovery = Rules.recoveryTimeFlags(p);
  if (recovery.length) {
    html += `<div class="alert alert-info"><h4>Recovery-time follow-up</h4><ul style="margin:4px 0 0;padding-left:18px;">`;
    recovery.forEach((r) => {
      html += `<li>Session ${fmtDate(r.sessionDate)} (${RECOVERY_LABELS[r.recovery]}): 24h — ${r.has24h ? "data available" : "<strong>no data at 24h</strong>"}, 48h — ${r.has48h ? "data available" : "<strong>no data at 48h</strong>"}</li>`;
    });
    html += `</ul></div>`;
  }

  const audit = Rules.programCompositionAudit(p);
  html += audit.length
    ? `<div class="alert alert-warning"><h4>Program composition audit</h4>Missing categories: ${audit.join(", ")}</div>`
    : `<div class="alert alert-success"><h4>Program composition audit: complete</h4>All four categories represented.</div>`;

  const split = Rules.sessionSplitSuggestion(p);
  html += split.suggest
    ? `<div class="alert alert-warning"><h4>Session-split suggestion</h4>Average RPE over last ${split.count} completed sessions is ${split.avgRpe.toFixed(1)} (>5).</div>`
    : `<div class="alert alert-success"><h4>Session-split: not suggested</h4>${split.avgRpe != null ? `Average RPE over last ${split.count} sessions: ${split.avgRpe.toFixed(1)}.` : "Not enough completed sessions yet."}</div>`;

  if (isIbmPatient(p)) {
    const decline = Rules.ibmfrsDeclineFlag(p);
    if (decline.triggered) {
      html += `<div class="alert alert-danger"><h4>IBMFRS meaningful decline</h4>${decline.message} (Total: ${decline.previousTotal} → ${decline.currentTotal})</div>`;
    } else if (decline.hasData) {
      html += `<div class="alert alert-success"><h4>IBMFRS: no meaningful decline</h4>Latest change: ${decline.delta > 0 ? "+" : ""}${decline.delta} points (higher is better).</div>`;
    }
  }
  html += "</div>";
  return html;
}

function renderProgram(p) {
  let html = '<div class="card"><h2>Foundation Program <span class="readonly-note">Read-only</span></h2>';
  p.program.forEach((ex) => {
    html += `<div class="exercise-item"><div class="head"><strong>${escapeHtml(ex.name)}</strong><span class="pill pill-${ex.category.toLowerCase()}">${ex.category}</span></div>`;
    html += `<p>${escapeHtml(ex.prescription)}</p>`;
    if (ex.progression) {
      html += `<p class="muted">Step ${ex.progression.step} of 4 · ${ex.progression.currentReps} reps @ ${ex.progression.currentWeight} lb · ${ex.progression.currentSets} set(s)</p>`;
    }
    html += "</div>";
  });
  html += "</div>";
  return html;
}

function renderFunctionalMeasures(p) {
  let html = '<div class="card"><h2>Functional Outcome Measures <span class="readonly-note">Read-only</span></h2>';
  if (!p.fom.length) {
    html += '<p class="muted">No measures recorded yet.</p></div>';
  } else {
    const measures = fomMeasuresFor(p);
    html += `<table><tr><th>Date</th>${measures.map((m) => `<th>${m.label}</th>`).join("")}</tr>`;
    p.fom.slice().reverse().forEach((f) => {
      html += `<tr><td>${fmtDate(f.date)}</td>${measures.map((m) => `<td>${f[m.key] != null ? f[m.key] : "—"}</td>`).join("")}</tr>`;
    });
    html += "</table></div>";

    if (isIbmPatient(p)) {
      const entries = p.fom.filter((f) => Array.isArray(f.ibmfrsItems)).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
      if (entries.length) {
        html += '<div class="card"><h2>IBMFRS per-item trend <span class="readonly-note">Read-only</span></h2><div class="grid">';
        IBMFRS_ITEMS.forEach((item, idx) => {
          const pts = entries.map((e) => ({ date: e.date, value: e.ibmfrsItems[idx] }));
          const first = pts[0].value, last = pts[pts.length - 1].value;
          const color = last > first ? "var(--success)" : last < first ? "var(--danger)" : "var(--muted)";
          html += `<div class="ibmfrs-item"><div class="item-label">${item.label}: ${item.placeholder}</div>${svgSparkline(pts, { yMin: 0, yMax: 4 })}<div style="font-size:12px;font-weight:700;color:${color}">${first} → ${last}</div></div>`;
        });
        html += "</div></div>";
      }
    }
  }

  if (p.mmt.length) {
    html += '<div class="card"><h2>Manual Muscle Test (0–5) <span class="readonly-note">Read-only</span></h2>';
    html += `<table><tr><th>Date</th><th>Hip flexors</th><th>Knee extensors</th><th>Shoulder abductors</th><th>Ankle dorsiflexors</th></tr>`;
    p.mmt.slice().reverse().forEach((m) => {
      html += `<tr><td>${fmtDate(m.date)}</td><td>${m.hipFlexors ?? "—"}</td><td>${m.kneeExtensors ?? "—"}</td><td>${m.shoulderAbductors ?? "—"}</td><td>${m.ankleDorsiflexors ?? "—"}</td></tr>`;
    });
    html += "</table></div>";
  }
  return html;
}

function renderRpePainFatigue(p) {
  const points = p.dailyLogs.filter((l) => l.logged).map((l) => ({ date: l.date, pain: l.pain, fatigue: l.fatigue, rpe: l.rpe }));
  const rpePts = points.filter((x) => x.rpe != null).map((x) => ({ date: x.date, value: x.rpe }));
  const painPts = points.map((x) => ({ date: x.date, value: x.pain }));
  const fatiguePts = points.map((x) => ({ date: x.date, value: x.fatigue }));
  return `<div class="card"><h2>RPE / Pain / Fatigue <span class="readonly-note">Read-only</span></h2>
    <p class="muted">RPE</p>${svgSparkline(rpePts, { yMin: 0, yMax: 10, color: "#2563a6", width: 300, height: 50 })}
    <p class="muted">Pain</p>${svgSparkline(painPts, { yMin: 0, yMax: 10, color: "#b3241c", width: 300, height: 50 })}
    <p class="muted">Fatigue</p>${svgSparkline(fatiguePts, { yMin: 0, yMax: 10, color: "#9a6b00", width: 300, height: 50 })}
    </div>`;
}

function renderClearanceStatus(p) {
  return `<div class="card"><h2>Clearance / Flare Status <span class="readonly-note">Read-only</span></h2>
    <p>Cleared for exercise: <strong>${p.clearedForExercise ? "Yes" : "No"}</strong></p>
    <p>Currently in flare: <strong>${p.inFlare ? "Yes" : "No"}</strong></p></div>`;
}

function renderPatientDashboard(p) {
  const body = `<div id="banner"><strong>Research Prototype</strong> — Seeded demo data only. Not connected to any real EHR or PHI. Read-only shared view.</div>
    <header><h1>${escapeHtml(p.name)}</h1><div class="muted">${escapeHtml(p.diagnosisSubtype)} · Target RPE ${p.targetRPE.min}–${p.targetRPE.max} · ${p.sessionsPerWeek}x/week</div></header>
    <main>
      ${renderAlerts(p)}
      ${renderProgram(p)}
      ${renderRpePainFatigue(p)}
      ${renderFunctionalMeasures(p)}
      ${renderClearanceStatus(p)}
    </main>`;
  return pageShell(`${p.name} — Myositis Home Companion (shared view)`, body);
}

module.exports = { renderInactiveLinkPage, renderPatientDashboard };
