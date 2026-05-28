export function requestTiming(req, res, next) {
  const start = Date.now();
  req._timing = { start: Date.now() };
  req._timingStartDB = null;
  req._timingDBTotal = 0;

  req.startDBTimer = () => {
    req._timingStartDB = Date.now();
  };
  req.endDBTimer = () => {
    if (req._timingStartDB) {
      req._timingDBTotal += Date.now() - req._timingStartDB;
      req._timingStartDB = null;
    }
  };

  res.on("finish", () => {
    req._timing.total = Date.now() - start;
  });

  next();
}
