/**
 * WebSocket server for real-time game synchronization.
 * Handles player position broadcasts and roster change notifications.
 */

import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import db from './db.js';

/** Map<gameId, Set<ClientInfo>> */
const rooms = new Map();

/** Map<gameId, { enabled, order, activeIndex }> – current turn state per game */
const roomTurnState = new Map();

/**
 * @typedef {Object} ClientInfo
 * @property {import('ws').WebSocket} ws
 * @property {number} userId
 * @property {string} username
 * @property {number} gameId
 * @property {string} role – 'dm' | 'player'
 */

/** Batch of positions to save to DB, keyed by characterId. */
const pendingPositionSaves = new Map();
let saveInterval = null;

/**
 * Initialize the WebSocket server on an existing HTTP server.
 * @param {import('http').Server} server
 */
export function initWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    /** @type {ClientInfo|null} */
    let client = null;

    // Expect first message to be auth
    const authTimeout = setTimeout(() => {
      if (!client) {
        ws.close(4001, 'Auth timeout');
      }
    }, 5000);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // ignore non-JSON
      }

      // --- Auth message (must be first) ---
      if (msg.type === 'auth') {
        clearTimeout(authTimeout);

        const user = verifyToken(msg.token);
        if (!user) {
          ws.close(4002, 'Invalid token');
          return;
        }

        const gameId = parseInt(msg.gameId, 10);
        if (!gameId) {
          ws.close(4003, 'Invalid game ID');
          return;
        }

        // Check game membership
        const membership = db.prepare(
          'SELECT role FROM game_players WHERE game_id = ? AND user_id = ?'
        ).get(gameId, user.id);

        if (!membership) {
          ws.close(4004, 'Not a member of this game');
          return;
        }

        // Register client
        client = {
          ws,
          userId: user.id,
          username: user.username,
          gameId,
          role: membership.role,
        };

        if (!rooms.has(gameId)) {
          rooms.set(gameId, new Set());
        }
        rooms.get(gameId).add(client);

        // Confirm auth — include current turn state if active
        const turnState = roomTurnState.get(gameId) || null;
        ws.send(JSON.stringify({ type: 'auth_ok', turnState }));
        return;
      }

      // All other messages require authentication
      if (!client) {
        ws.close(4005, 'Not authenticated');
        return;
      }

      // --- Position update ---
      if (msg.type === 'move') {
        handleMove(client, msg);
        return;
      }

      // --- Character added ---
      if (msg.type === 'character_added') {
        broadcastToOthers(client, {
          type: 'character_added',
          character: msg.character,
        });
        return;
      }

      // --- Character removed ---
      if (msg.type === 'character_removed') {
        broadcastToOthers(client, {
          type: 'character_removed',
          characterId: msg.characterId,
        });
        return;
      }

      // --- Turn update (DM only) ---
      if (msg.type === 'turn_update') {
        if (client.role !== 'dm') return; // only DM can update turns
        const turnState = {
          enabled: !!msg.enabled,
          order: Array.isArray(msg.order) ? msg.order : [],
          activeIndex: typeof msg.activeIndex === 'number' ? msg.activeIndex : -1,
        };
        // Store on room so new joiners get current state
        roomTurnState.set(client.gameId, turnState);
        // Include sorted player order if present (from DM initiative sort)
        const broadcast = { type: 'turn_update', ...turnState };
        if (Array.isArray(msg.sortedPlayerOrder)) {
          broadcast.sortedPlayerOrder = msg.sortedPlayerOrder;
        }
        // Broadcast to ALL clients in the room (including sender for confirmation)
        broadcastToAll(client.gameId, broadcast);
        return;
      }

      // --- Initiative roll (any player for own character, or DM for any) ---
      if (msg.type === 'initiative_roll') {
        const { characterId, roll } = msg;
        if (characterId == null) return;
        // Validate: DM can set any, players can only set their own
        if (client.role !== 'dm') {
          const char = db.prepare('SELECT user_id FROM characters WHERE id = ?').get(characterId);
          if (!char || char.user_id !== client.userId) return;
        }
        // Broadcast to all clients (including sender for confirmation)
        broadcastToAll(client.gameId, {
          type: 'initiative_roll',
          characterId,
          roll: typeof roll === 'number' ? roll : null,
          userId: client.userId,
        });
        return;
      }

      // --- Initiative sort (DM only) ---
      if (msg.type === 'initiative_sort') {
        if (client.role !== 'dm') return; // only DM can sort initiative
        const sortedCharIds = Array.isArray(msg.sortedCharIds) ? msg.sortedCharIds : [];
        broadcastToAll(client.gameId, { type: 'initiative_sort', sortedCharIds });
        return;
      }

      // --- Chat message ---
      if (msg.type === 'chat_message') {
        handleChatMessage(client, msg);
        return;
      }

      // --- DM drag (DM only) ---
      if (msg.type === 'dm_drag') {
        if (client.role !== 'dm') return;
        const { characterId, x, y } = msg;
        if (characterId == null || x == null || y == null) return;
        // Broadcast to others
        broadcastToOthers(client, { type: 'dm_drag', characterId, x, y });
        // Queue position for DB save (reuse existing mechanism)
        pendingPositionSaves.set(characterId, { x, y, angle: null });
        return;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (client) {
        const room = rooms.get(client.gameId);
        if (room) {
          room.delete(client);
          if (room.size === 0) {
            rooms.delete(client.gameId);
            roomTurnState.delete(client.gameId);
          }
        }
      }
    });

    ws.on('error', () => {
      // Handled by close event
    });
  });

  // Periodic batch save of positions to DB (every 3 seconds)
  saveInterval = setInterval(flushPositionSaves, 3000);

  console.log('WebSocket server initialized on /ws');
}

/**
 * Handle a chat message: validate, persist to DB, route to recipients.
 */
function handleChatMessage(client, msg) {
  let content = typeof msg.content === 'string' ? msg.content.trim() : '';
  if (!content || content.length > 500) return;

  const recipientId = typeof msg.recipientId === 'number' ? msg.recipientId : null;

  // Validate optional roll data
  let roll = null;
  if (msg.roll && typeof msg.roll === 'object') {
    const { sides, count, results, total } = msg.roll;
    if (typeof sides === 'number' && typeof count === 'number'
        && Array.isArray(results) && typeof total === 'number') {
      roll = { sides, count, results, total };
    }
  }

  // Persist to database
  const result = db.prepare(
    'INSERT INTO messages (game_id, sender_id, sender_name, recipient_id, content) VALUES (?, ?, ?, ?, ?)'
  ).run(client.gameId, client.userId, client.username, recipientId, content);

  const outMsg = {
    type: 'chat_message',
    id: Number(result.lastInsertRowid),
    senderId: client.userId,
    senderName: client.username,
    recipientId,
    content,
    roll,
    createdAt: new Date().toISOString(),
  };

  if (recipientId === null) {
    // Group message — broadcast to everyone in the room
    broadcastToAll(client.gameId, outMsg);
  } else {
    // DM — send to sender + recipient only
    const data = JSON.stringify(outMsg);
    const room = rooms.get(client.gameId);
    if (!room) return;
    for (const c of room) {
      if ((c.userId === client.userId || c.userId === recipientId) && c.ws.readyState === 1) {
        c.ws.send(data);
      }
    }
  }
}

/**
 * Handle a move message: validate ownership, broadcast to room, queue DB save.
 */
function handleMove(client, msg) {
  const { characterId, x, y, angle } = msg;
  if (characterId == null || x == null || y == null || angle == null) return;

  // Verify ownership: must own the character or be DM
  if (client.role !== 'dm') {
    const char = db.prepare('SELECT user_id FROM characters WHERE id = ?').get(characterId);
    if (!char || char.user_id !== client.userId) return;
  }

  // Broadcast to all OTHER clients in the same game
  broadcastToOthers(client, {
    type: 'move',
    characterId,
    x,
    y,
    angle,
  });

  // Queue position for batch DB save
  pendingPositionSaves.set(characterId, { x, y, angle });
}

/**
 * Send a message to all other clients in the same game room.
 */
function broadcastToOthers(sender, message) {
  const room = rooms.get(sender.gameId);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const client of room) {
    if (client !== sender && client.ws.readyState === 1) { // OPEN = 1
      client.ws.send(data);
    }
  }
}

/**
 * Send a message to ALL clients in a game room (including sender).
 */
function broadcastToAll(gameId, message) {
  const room = rooms.get(gameId);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const client of room) {
    if (client.ws.readyState === 1) {
      client.ws.send(data);
    }
  }
}

/**
 * Flush queued position updates to the database.
 */
function flushPositionSaves() {
  if (pendingPositionSaves.size === 0) return;

  const updateWithAngle = db.prepare(
    'UPDATE characters SET x = ?, y = ?, angle = ? WHERE id = ?'
  );
  const updateXY = db.prepare(
    'UPDATE characters SET x = ?, y = ? WHERE id = ?'
  );

  const saveMany = db.transaction((entries) => {
    for (const [charId, pos] of entries) {
      if (pos.angle != null) {
        updateWithAngle.run(pos.x, pos.y, pos.angle, charId);
      } else {
        updateXY.run(pos.x, pos.y, charId);
      }
    }
  });

  saveMany([...pendingPositionSaves.entries()]);
  pendingPositionSaves.clear();
}
