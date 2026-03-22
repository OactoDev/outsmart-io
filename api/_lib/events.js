/**
 * In-process event broadcast for Outsmart.io
 * Replaces Pusher — zero external dependencies.
 * Uses Node.js EventEmitter + SSE for real-time delivery.
 */
const EventEmitter = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(200);

/** Broadcast an event to all SSE subscribers of a room */
function broadcast(roomCode, eventName, data) {
  bus.emit(`room:${roomCode}`, { event: eventName, data });
}

/** Subscribe to all events for a room. Returns an unsubscribe function. */
function subscribe(roomCode, callback) {
  const handler = (msg) => callback(msg);
  bus.on(`room:${roomCode}`, handler);
  return () => bus.off(`room:${roomCode}`, handler);
}

module.exports = { broadcast, subscribe };
