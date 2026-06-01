// Exact same imports as the real codebase
import { Router } from "express";
import express from "express";

const app = express();

// Simulate the exact same router setup as alerts.js
const router = Router();

router.get("/", (req, res) => {
  console.log("ROOT handler called for:", req.originalUrl);
  res.json({ route: "root" });
});

router.get("/events", (req, res) => {
  console.log("EVENTS handler called for:", req.originalUrl);
  res.json({ route: "events" });
});

app.use("/api/alerts", router);

const s = app.listen(3098, async () => {
  const tests = [
    "http://localhost:3098/api/alerts/",
    "http://localhost:3098/api/alerts",
    "http://localhost:3098/api/alerts/events",
    "http://localhost:3098/api/alerts/events?foo=bar",
  ];
  for (const url of tests) {
    const r = await fetch(url);
    console.log(r.status, url, await r.text());
  }
  s.close();
  process.exit(0);
});
