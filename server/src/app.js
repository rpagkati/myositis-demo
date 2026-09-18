"use strict";
const express = require("express");
const cors = require("cors");
const ptView = require("./routes/ptView");
const sharingApi = require("./routes/sharingApi");

function createApp() {
  const app = express();

  // Trust the first proxy hop (typical on Render/Railway/Fly/etc — needed
  // for req.secure and x-forwarded-proto to reflect the real client scheme).
  app.set("trust proxy", 1);

  // Enforce HTTPS in production. Most PaaS platforms terminate TLS at a
  // load balancer and forward plain HTTP internally, so this checks
  // x-forwarded-proto rather than req.protocol alone.
  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== "production") return next();
    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
    if (!isSecure) {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGIN || "*", // set ALLOWED_ORIGIN to your GitHub Pages origin in production
    })
  );
  app.use(express.json());

  app.get("/healthz", (req, res) => res.json({ ok: true }));

  app.use("/", ptView);
  app.use("/api", sharingApi);

  // Keep error details out of responses; log server-side only.
  app.use((err, req, res, next) => {
    console.error("[app] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}

module.exports = { createApp };
