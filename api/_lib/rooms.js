/**
 * In-memory room store for Outsmart.io
 * 
 * NOTE: This lives in a serverless function's module scope.
 * On Vercel, each cold start resets it. For production, swap to
 * Vercel KV (Redis). For local dev & prototyping this works fine.
 */

const rooms = new Map();

const ROOM_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function createRoom(roomCode, hostId) {
  const room = {
    code: roomCode,
    hostId,
    players: [],          // [{ id, nickname, joinedAt }]
    phase: 'lobby',       // lobby | drawing | judging | scores
    round: 0,
    maxPlayers: 8,
    currentWord: null,    // the word players must draw this round
    roundStartTime: null, // timestamp when drawing phase started
    correctPlayers: new Set(),
    createdAt: Date.now(),
  };
  rooms.set(roomCode, room);
  return room;
}

function getRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  // Auto-expire old rooms
  if (Date.now() - room.createdAt > ROOM_EXPIRY_MS) {
    rooms.delete(roomCode);
    return null;
  }
  return room;
}

function addPlayer(roomCode, playerId, nickname) {
  const room = getRoom(roomCode);
  if (!room) return { error: 'Room not found' };
  if (room.players.length >= room.maxPlayers) return { error: 'Room is full' };
  if (room.phase !== 'lobby') return { error: 'Game already in progress' };
  // Prevent duplicate nicknames
  if (room.players.some(p => p.nickname.toLowerCase() === nickname.toLowerCase())) {
    return { error: 'Nickname already taken' };
  }
  const player = { id: playerId, nickname, joinedAt: Date.now() };
  room.players.push(player);
  return { player, room };
}

function removePlayer(roomCode, playerId) {
  const room = getRoom(roomCode);
  if (!room) return;
  room.players = room.players.filter(p => p.id !== playerId);
}

function deleteRoom(roomCode) {
  rooms.delete(roomCode);
}

function listRooms() {
  // Cleanup expired
  for (const [code, room] of rooms) {
    if (Date.now() - room.createdAt > ROOM_EXPIRY_MS) rooms.delete(code);
  }
  return [...rooms.values()].map(r => ({
    code: r.code,
    playerCount: r.players.length,
    phase: r.phase,
  }));
}

function roomCount() {
  return rooms.size;
}

module.exports = { createRoom, getRoom, addPlayer, removePlayer, deleteRoom, listRooms, roomCount };
