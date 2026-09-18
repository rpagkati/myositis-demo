"use strict";
const { createApp } = require("./app");
const { getDb } = require("./db");
const { seed } = require("./seed");

const db = getDb();
seed(db);

const app = createApp();
const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Myositis Home Companion backend listening on port ${port} (NODE_ENV=${process.env.NODE_ENV || "development"})`);
  if (!process.env.POSTMARK_API_TOKEN) {
    console.log("POSTMARK_API_TOKEN not set — sharing-link emails will be logged, not actually sent. See .env.example.");
  }
});
