import { EventEmitter } from "events";

const bus = new EventEmitter();
bus.setMaxListeners(200);

export const Events = {
  METRICS_UPDATE: "metrics:update",
  PROVIDER_HEALTH: "provider:health",
  ALERT_EVENT: "alert:event",
};

export function emitMetricsUpdate(projectId, data) {
  bus.emit(`${Events.METRICS_UPDATE}:${projectId}`, data);
}

export function emitProviderHealth(data) {
  bus.emit(Events.PROVIDER_HEALTH, data);
}

export function emitAlertEvent(projectId, data) {
  bus.emit(`${Events.ALERT_EVENT}:${projectId}`, data);
}

export function subscribe(event, callback) {
  bus.on(event, callback);
  return () => bus.off(event, callback);
}

export function subscribeProject(event, projectId, callback) {
  const key = `${event}:${projectId}`;
  bus.on(key, callback);
  return () => bus.off(key, callback);
}

export default bus;
