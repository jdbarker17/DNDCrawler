/**
 * Frontend WebSocket service for real-time game synchronization.
 * Connects to the server, sends local position updates, receives remote ones.
 */

import { getToken } from './api.js';

let ws = null;
let connected = false;
let gameId = null;
let reconnectTimer = null;
let reconnectDelay = 1000;

// Throttle: max ~15 position updates per second (66ms interval)
let lastSendTime = 0;
const SEND_INTERVAL = 66;

// --- Event handlers (registered by main.js) ---
const handlers = {
  move: [],
  character_added: [],
  character_removed: [],
  turn_update: [],
  dm_drag: [],
  initiative_roll: [],
  initiative_sort: [],
  chat_message: [],
};

/**
 * Connect to the WebSocket server for a specific game.
 * @param {number} gId – game ID to join
 */
export function connect(gId) {
  gameId = gId;
  reconnectDelay = 1000;
  _open();
}

function _open() {
  if (ws) {
    ws.close();
    ws = null;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    // Send auth message
    const token = getToken();
    if (!token || !gameId) {
      ws.close();
      return;
    }
    ws.send(JSON.stringify({ type: 'auth', token, gameId }));
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === 'auth_ok') {
      connected = true;
      reconnectDelay = 1000;
      // Server may include current turn state for reconnecting clients
      if (msg.turnState) {
        const fns = handlers.turn_update;
        for (const fn of fns) {
          fn(msg.turnState);
        }
      }
      return;
    }

    // Dispatch to registered handlers
    const fns = handlers[msg.type];
    if (fns) {
      for (const fn of fns) {
        fn(msg);
      }
    }
  });

  ws.addEventListener('close', () => {
    connected = false;
    ws = null;

    // Auto-reconnect if we still have a gameId
    if (gameId) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
        _open();
      }, reconnectDelay);
    }
  });

  ws.addEventListener('error', () => {
    // Will trigger close event
  });
}

/**
 * Disconnect from the WebSocket server.
 */
export function disconnect() {
  gameId = null;
  connected = false;
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.close();
    ws = null;
  }
}

/**
 * Send a position update for a character (throttled).
 * @param {number} characterId
 * @param {number} x
 * @param {number} y
 * @param {number} angle
 */
export function sendMove(characterId, x, y, angle) {
  if (!connected || !ws) return;

  const now = performance.now();
  if (now - lastSendTime < SEND_INTERVAL) return;
  lastSendTime = now;

  ws.send(JSON.stringify({
    type: 'move',
    characterId,
    x,
    y,
    angle,
  }));
}

/**
 * Notify other clients that a character was added.
 * @param {object} character – the server character record
 */
export function sendCharacterAdded(character) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'character_added', character }));
}

/**
 * Notify other clients that a character was removed.
 * @param {number} characterId
 */
export function sendCharacterRemoved(characterId) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'character_removed', characterId }));
}

/**
 * Send a turn state update (DM only — server validates).
 * @param {{ enabled: boolean, order?: number[], activeIndex?: number }} turnState
 */
export function sendTurnUpdate(turnState) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'turn_update', ...turnState }));
}

/**
 * Send a DM drag-move for a character (not throttled).
 * @param {number} characterId
 * @param {number} x
 * @param {number} y
 */
export function sendDMDrag(characterId, x, y) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'dm_drag', characterId, x, y }));
}

/**
 * Send an initiative roll for a character.
 * Server validates ownership (player must own character, or be DM).
 * @param {number} characterId
 * @param {number|null} roll – the initiative value (null to clear)
 */
export function sendInitiativeRoll(characterId, roll) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'initiative_roll', characterId, roll }));
}

/**
 * Send an initiative sort event (DM only — server validates).
 * Broadcasts the sorted character ID order to all clients.
 * @param {number[]} sortedCharIds – character IDs in sorted order
 */
export function sendInitiativeSort(sortedCharIds) {
  if (!connected || !ws) return;
  ws.send(JSON.stringify({ type: 'initiative_sort', sortedCharIds }));
}

/**
 * Send a chat message (group or DM), optionally with dice roll data.
 * @param {string} content – message text
 * @param {number|null} recipientId – null for group, userId for DM
 * @param {object|null} roll – optional dice roll data { sides, count, results, total }
 */
export function sendChatMessage(content, recipientId = null, roll = null) {
  if (!connected || !ws) return;
  const msg = { type: 'chat_message', content, recipientId };
  if (roll) msg.roll = roll;
  ws.send(JSON.stringify(msg));
}

// --- Register event handlers ---

/**
 * Register a handler for remote player position updates.
 * Callback receives: { characterId, x, y, angle }
 */
export function onRemoteMove(callback) {
  handlers.move.push(callback);
}

/**
 * Register a handler for when a remote player adds a character.
 * Callback receives: { character: { id, user_id, name, ... } }
 */
export function onCharacterAdded(callback) {
  handlers.character_added.push(callback);
}

/**
 * Register a handler for when a remote player removes a character.
 * Callback receives: { characterId }
 */
export function onCharacterRemoved(callback) {
  handlers.character_removed.push(callback);
}

/**
 * Register a handler for turn state updates.
 * Callback receives: { enabled, order?, activeIndex? }
 */
export function onTurnUpdate(callback) {
  handlers.turn_update.push(callback);
}

/**
 * Register a handler for DM drag-move updates.
 * Callback receives: { characterId, x, y }
 */
export function onDMDrag(callback) {
  handlers.dm_drag.push(callback);
}

/**
 * Register a handler for initiative roll updates.
 * Callback receives: { characterId, roll, userId }
 */
export function onInitiativeRoll(callback) {
  handlers.initiative_roll.push(callback);
}

/**
 * Register a handler for initiative sort updates.
 * Callback receives: { sortedCharIds: number[] }
 */
export function onInitiativeSort(callback) {
  handlers.initiative_sort.push(callback);
}

/**
 * Register a handler for chat messages.
 * Callback receives: { id, senderId, senderName, recipientId, content, createdAt }
 */
export function onChatMessage(callback) {
  handlers.chat_message.push(callback);
}

/**
 * Clear all event handlers (called on cleanup).
 */
export function clearHandlers() {
  handlers.move.length = 0;
  handlers.character_added.length = 0;
  handlers.character_removed.length = 0;
  handlers.turn_update.length = 0;
  handlers.dm_drag.length = 0;
  handlers.initiative_roll.length = 0;
  handlers.initiative_sort.length = 0;
  handlers.chat_message.length = 0;
}
