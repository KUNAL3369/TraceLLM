import express from "express";
const app = express();
const r = express.Router();

r.get("/", (req, res) => res.json({ route: "root" }));
r.get("/events", (req, res) => res.json({ route: "events" }));

app.use("/api/alerts", r);

const s = app.listen(3099, async () => {
  const r1 = await fetch("http://localhost:3099/api/alerts/");
  console.log("GET /api/alerts/        =>", r1.status, await r1.text());
  const r2 = await fetch("http://localhost:3099/api/alerts/events");
  console.log("GET /api/alerts/events  =>", r2.status, await r2.text());
  const r3 = await fetch("http://localhost:3099/api/alerts/events/");
  console.log("GET /api/alerts/events/ =>", r3.status, await r3.text());
  s.close();
  process.exit(0);
});
