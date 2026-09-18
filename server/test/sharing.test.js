"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const dbModule = require("../src/db");
const rateLimit = require("../src/rateLimit");
const repo = require("../src/repo");
const { seed } = require("../src/seed");
const { generateToken } = require("../src/tokens");
const { createApp } = require("../src/app");

// Fresh in-memory DB + rate limiter + a real HTTP server on an ephemeral
// port for every test, so tests can't leak state into each other.
async function setupServer() {
  dbModule.resetForTests();
  rateLimit.resetForTests();
  process.env.DB_PATH = ":memory:";
  const db = dbModule.getDb();
  seed(db);

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { db, server, baseUrl };
}

function teardown(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("pt-view for one patient's token never returns another patient's data", async () => {
  const { db, server, baseUrl } = await setupServer();
  try {
    const tokenAlex = generateToken();
    repo.createSharingLink(db, { token: tokenAlex, patientId: "p1", ptEmail: "pt@example.org", ptName: "Test PT", ttlDays: 90 });
    const tokenJordan = generateToken(); // p2 already has a seeded link too, but mint a distinct one to be explicit
    repo.createSharingLink(db, { token: tokenJordan, patientId: "p2", ptEmail: "pt2@example.org", ptName: "Test PT 2", ttlDays: 90 });

    const resAlex = await fetch(`${baseUrl}/pt-view/${tokenAlex}`);
    const bodyAlex = await resAlex.text();
    assert.equal(resAlex.status, 200);
    assert.match(bodyAlex, /Alex Rivera/);
    assert.doesNotMatch(bodyAlex, /Jordan Blake/);

    const resJordan = await fetch(`${baseUrl}/pt-view/${tokenJordan}`);
    const bodyJordan = await resJordan.text();
    assert.equal(resJordan.status, 200);
    assert.match(bodyJordan, /Jordan Blake/);
    assert.doesNotMatch(bodyJordan, /Alex Rivera/);

    // Cross-check: Alex's token must not work as if it were Jordan's, and vice versa.
    assert.notEqual(tokenAlex, tokenJordan);
  } finally {
    await teardown(server);
  }
});

test("unknown token shows the inactive-link message, not a generic error", async () => {
  const { server, baseUrl } = await setupServer();
  try {
    const res = await fetch(`${baseUrl}/pt-view/${"0".repeat(64)}`);
    const body = await res.text();
    assert.equal(res.status, 404);
    assert.match(body, /no longer active/i);
    assert.doesNotMatch(body, /Alex Rivera|Jordan Blake|Sam Okafor|Priya Nair/);
  } finally {
    await teardown(server);
  }
});

test("expired token shows the inactive-link message", async () => {
  const { db, server, baseUrl } = await setupServer();
  try {
    const token = generateToken();
    repo.createSharingLink(db, { token, patientId: "p1", ptEmail: "pt@example.org", ptName: "Test PT", ttlDays: -1 }); // already expired
    const res = await fetch(`${baseUrl}/pt-view/${token}`);
    const body = await res.text();
    assert.equal(res.status, 410);
    assert.match(body, /no longer active/i);
  } finally {
    await teardown(server);
  }
});

test("revoked token stops working immediately", async () => {
  const { db, server, baseUrl } = await setupServer();
  try {
    const token = generateToken();
    repo.createSharingLink(db, { token, patientId: "p1", ptEmail: "pt@example.org", ptName: "Test PT", ttlDays: 90 });

    const before = await fetch(`${baseUrl}/pt-view/${token}`);
    assert.equal(before.status, 200);

    const disableRes = await fetch(`${baseUrl}/api/patients/p1/sharing/disable`, { method: "POST" });
    assert.equal(disableRes.status, 200);

    const after = await fetch(`${baseUrl}/pt-view/${token}`);
    const afterBody = await after.text();
    assert.equal(after.status, 410);
    assert.match(afterBody, /no longer active/i);
  } finally {
    await teardown(server);
  }
});

test("successful pt-view access records lastAccessedAt and increments accessCount", async () => {
  const { db, server, baseUrl } = await setupServer();
  try {
    const token = generateToken();
    repo.createSharingLink(db, { token, patientId: "p1", ptEmail: "pt@example.org", ptName: "Test PT", ttlDays: 90 });

    await fetch(`${baseUrl}/pt-view/${token}`);
    await fetch(`${baseUrl}/pt-view/${token}`);

    const link = repo.findLinkByToken(db, token);
    assert.equal(link.access_count, 2);
    assert.ok(link.last_accessed_at, "lastAccessedAt should be set after a successful access");
  } finally {
    await teardown(server);
  }
});

test("enabling sharing creates a working link end-to-end", async () => {
  const { server, baseUrl } = await setupServer();
  try {
    const res = await fetch(`${baseUrl}/api/patients/p3/sharing/enable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ptName: "New PT", ptEmail: "newpt@example.org" }),
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.link.status, "active");
    assert.equal(json.sharingEnabled, true);

    const statusRes = await fetch(`${baseUrl}/api/patients/p3/sharing/status`);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.sharingEnabled, true);
    assert.equal(statusJson.link.ptEmail, "newpt@example.org");
  } finally {
    await teardown(server);
  }
});

test("rejects an invalid email on enable", async () => {
  const { server, baseUrl } = await setupServer();
  try {
    const res = await fetch(`${baseUrl}/api/patients/p3/sharing/enable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ptName: "New PT", ptEmail: "not-an-email" }),
    });
    assert.equal(res.status, 400);
  } finally {
    await teardown(server);
  }
});

test("rate limits sends to 3 per patient per hour", async () => {
  const { server, baseUrl } = await setupServer();
  try {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/patients/p3/sharing/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ptName: "PT " + i, ptEmail: `pt${i}@example.org` }),
      });
      assert.equal(res.status, 200, `send #${i + 1} should succeed`);
    }
    const fourth = await fetch(`${baseUrl}/api/patients/p3/sharing/enable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ptName: "PT 4", ptEmail: "pt4@example.org" }),
    });
    assert.equal(fourth.status, 429);
    assert.ok(fourth.headers.get("retry-after"));
  } finally {
    await teardown(server);
  }
});

test("seeded demo link for Jordan Blake is active and shows prior access", async () => {
  const { db, server } = await setupServer();
  try {
    const link = repo.getLatestLinkForPatient(db, "p2");
    assert.ok(link, "seed should create a sharing link for p2");
    assert.equal(repo.linkStatus(link), "active");
    assert.ok(link.last_accessed_at, "seeded demo link should show a prior access");
    assert.ok(link.access_count > 0);
  } finally {
    await teardown(server);
  }
});
