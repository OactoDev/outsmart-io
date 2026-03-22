/**
 * ═══════════════════════════════════════════════════════════════
 *  SINGLE API HANDLER — all routes consolidated.
 *  Uses in-process SSE broadcast instead of Pusher.
 *  Zero external dependencies.
 * ═══════════════════════════════════════════════════════════════
 */
const crypto = require('crypto');
const { createRoom, getRoom, addPlayer, listRooms, roomCount } = require('./_lib/rooms');
const { getRandomWord } = require('./_lib/words');
const { broadcast } = require('./_lib/events');

/* ── CORS helper ─────────────────────────────────────────────── */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ══════════════════════════════════════════════════════════════
 *  MAIN HANDLER — routes by URL path
 * ══════════════════════════════════════════════════════════════ */
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const u = new URL(req.url, 'http://localhost');
  const path = u.pathname;

  // Merge query params from URL
  const urlQuery = Object.fromEntries(u.searchParams);
  req.query = { ...req.query, ...urlQuery };

  /* ── POST /api/rooms/create ──────────────────────────────────── */
  if (path === '/api/rooms/create' && req.method === 'POST') {
    try {
      const { hostId } = req.body || {};
      if (!hostId) return res.status(400).json({ error: 'hostId is required' });

      const roomCode = crypto.randomBytes(3).toString('hex').slice(0, 6).toUpperCase();
      const room = createRoom(roomCode, hostId);
      console.log(`✓ Room created: ${roomCode} (total: ${roomCount()})`);

      return res.status(201).json({
        roomCode,
        room: { code: room.code, hostId: room.hostId, players: room.players, phase: room.phase },
      });
    } catch (err) {
      console.error('Create room error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /* ── POST /api/rooms/join ────────────────────────────────────── */
  if (path === '/api/rooms/join' && req.method === 'POST') {
    try {
      const { roomCode, playerId, nickname } = req.body || {};
      if (!roomCode || !playerId || !nickname)
        return res.status(400).json({ error: 'roomCode, playerId, and nickname required' });

      const code = roomCode.toUpperCase().trim();
      console.log(`Join attempt: ${code} — rooms in memory: [${listRooms().map(r => r.code).join(', ')}]`);

      const result = addPlayer(code, playerId, nickname.trim());
      if (result.error) return res.status(400).json({ error: result.error });

      broadcast(code, 'player-joined', {
        player: result.player,
        players: result.room.players,
      });

      return res.status(200).json({
        player: result.player,
        room: { code: result.room.code, phase: result.room.phase, players: result.room.players },
      });
    } catch (err) {
      console.error('Join room error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /* ── POST /api/draw ──────────────────────────────────────────── */
  if (path === '/api/draw' && req.method === 'POST') {
    try {
      const { roomCode, playerId, strokeData } = req.body || {};
      if (!roomCode || !playerId || !strokeData)
        return res.status(400).json({ error: 'roomCode, playerId, strokeData required' });

      const code = roomCode.toUpperCase().trim();
      broadcast(code, 'drawing-stroke', { playerId, strokeData });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Draw error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /* ── POST /api/guess (AI guess via Gemini) ───────────────────── */
  if (path === '/api/guess' && req.method === 'POST') {
    try {
      const { roomCode, imageData } = req.body || {};
      if (!roomCode) return res.status(400).json({ error: 'roomCode required' });

      const code = roomCode.toUpperCase().trim();
      const room = getRoom(code);

      let guess = '';
      let confidence = 0;
      let correct = false;
      const currentWord = room?.currentWord || '';

      const GEMINI_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_KEY) {
        console.error('GEMINI_API_KEY not set');
        return res.status(500).json({ error: 'AI service not configured' });
      }

      if (imageData) {
        try {
          const base64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;

          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
          const r = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: 'You are playing a drawing guessing game. This is a pixel art drawing in progress. Try your best to guess what object, animal, or thing is being drawn, even if the drawing is incomplete or rough. Think about common drawing game words like animals, food, vehicles, nature, household objects. Reply with ONLY a single word — your best guess. No punctuation, no explanation, just one word.' },
                  { inlineData: { mimeType: 'image/png', data: base64 } }
                ]
              }],
              generationConfig: { temperature: 0.5, maxOutputTokens: 200 },
            }),
          });

          const d = await r.json();
          console.log('Gemini response:', JSON.stringify(d).slice(0, 300));

          if (d.candidates?.[0]?.content?.parts?.[0]?.text) {
            let raw = d.candidates[0].content.parts[0].text.trim().toLowerCase().replace(/[^a-z\s]/g, '');
            guess = raw.split(/\s+/)[0] || raw;
            confidence = 0.85;
          } else {
            console.warn('Gemini: no valid candidate returned', JSON.stringify(d).slice(0, 200));
          }
        } catch (e) {
          console.warn('Gemini error:', e.message);
        }
      }

      if (!guess) {
        guess = '...';
        confidence = 0;
      }

      if (currentWord && guess !== '...') {
        const ng = guess.toLowerCase().trim();
        const nw = currentWord.toLowerCase().trim();
        correct = ng === nw || nw.includes(ng) || ng.includes(nw);
      }

      broadcast(code, 'ai-guess', { guess, correct, confidence: Math.round(confidence * 100) });
      return res.status(200).json({ guess, correct, confidence: Math.round(confidence * 100) });
    } catch (err) {
      console.error('Guess error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /* ── POST /api/player-guess — mobile players guess the word ──── */
  if (path === '/api/player-guess' && req.method === 'POST') {
    try {
      const { roomCode, playerId, playerName, guess } = req.body || {};
      if (!roomCode || !playerId || !guess)
        return res.status(400).json({ error: 'roomCode, playerId, guess required' });

      const code = roomCode.toUpperCase().trim();
      const room = getRoom(code);
      if (!room) return res.status(404).json({ error: 'Room not found' });
      if (room.phase !== 'drawing')
        return res.status(400).json({ error: 'Game is not in drawing phase' });

      // Check if this player already guessed correctly
      if (room.correctPlayers && room.correctPlayers.has(playerId))
        return res.status(400).json({ error: 'You already guessed correctly', correct: true });

      const ng = guess.toLowerCase().trim();
      const nw = (room.currentWord || '').toLowerCase().trim();
      const correct = ng === nw;

      if (correct && room.correctPlayers) {
        room.correctPlayers.add(playerId);
      }

      // Broadcast — if correct, mask the guess so others don't see the answer
      const broadcastGuess = correct ? '*'.repeat(nw.length) : ng;
      broadcast(code, 'player-guessed', {
        playerId,
        playerName: playerName || 'Player',
        guess: broadcastGuess,
        correct,
      });

      // Check if ALL players have guessed correctly
      const totalPlayers = room.players.length;
      const correctCount = room.correctPlayers ? room.correctPlayers.size : 0;
      const allCorrect = correctCount >= totalPlayers && totalPlayers > 0;

      if (allCorrect) {
        room.phase = 'ended';
        broadcast(code, 'game-ended', {
          reason: 'player_won',
          word: room.currentWord,
          winner: 'All players',
        });
      }

      return res.status(200).json({
        correct, guess: ng,
        correctCount, totalPlayers, allCorrect,
      });
    } catch (err) {
      console.error('Player guess error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /* ── POST /api/end-game ──────────────────────────────────────── */
  if (path === '/api/end-game' && req.method === 'POST') {
    try {
      const { roomId, reason } = req.body || {};
      if (!roomId) return res.status(400).json({ error: 'Missing roomId' });

      const code = roomId.toUpperCase().trim();
      const room = getRoom(code);

      broadcast(code, 'game-ended', {
        reason: reason || 'timeout',
        word: room?.currentWord,
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('End game error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /* ── GET/POST /api/rooms/:roomId ─────────────────────────────── */
  const roomMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)$/);
  if (roomMatch) {
    const code = roomMatch[1].toUpperCase().trim();
    const room = getRoom(code);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    if (req.method === 'GET') {
      return res.status(200).json({
        code: room.code, hostId: room.hostId,
        players: room.players, phase: room.phase, round: room.round,
      });
    }

    if (req.method === 'POST') {
      const { hostId, action } = req.body || {};
      if (hostId !== room.hostId)
        return res.status(403).json({ error: 'Only the host can control the room' });

      if (action === 'start') {
        if (room.players.length < 1)
          return res.status(400).json({ error: 'Need at least 1 player' });

        room.phase = 'drawing';
        room.round += 1;
        room.currentWord = getRandomWord();
        room.roundStartTime = Date.now();
        room.correctPlayers = new Set();

        // Broadcast WITHOUT the word — players must not see it
        broadcast(code, 'game-started', {
          phase: room.phase,
          round: room.round,
        });

        // Return word only in HTTP response (host only)
        return res.status(200).json({ phase: room.phase, round: room.round, word: room.currentWord });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }
  }

  /* ── GET /api/debug — list rooms ─────────────────────────────── */
  if (path === '/api/debug' && req.method === 'GET') {
    return res.status(200).json({
      roomCount: roomCount(),
      rooms: listRooms(),
    });
  }

  /* ── 404 ─────────────────────────────────────────────────────── */
  return res.status(404).json({ error: 'Not found', path });
};
