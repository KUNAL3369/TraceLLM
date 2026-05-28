import { v4 as uuidv4 } from "uuid";

export function requestId(req, _res, next) {
  req.id = uuidv4();
  next();
}
