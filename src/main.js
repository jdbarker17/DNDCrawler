/**
 * Main application entry point.
 * Handles auth flow, game lobby, then wires together the map, players,
 * both renderers, input, DM tools, and game loop.
 */

import { createDemoMap } from './engine/DemoMap.js';
import { GameMap } from './engine/GameMap.js';
import { Player } from './engine/Player.js';
import { InputManager } from './engine/InputManager.js';
import { MapRenderer2D } from './renderers/MapRenderer2D.js';
import { RaycastRenderer } from './renderers/RaycastRenderer.js';
import { DMTools } from './ui/DMTools.js';
import { PlayerRoster } from './ui/PlayerRoster.js';
import { TurnTracker } from './ui/TurnTracker.js';
import { ChatPanel } from './ui/ChatPanel.js';
import { AuthScreen } from './ui/AuthScreen.js';
import { GameLobby } from './ui/GameLobby.js';
import {
  getCurrentUser, logout, getGameState, updateCharacter, saveMapData,
  getMessages,
} from './services/api.js';
import * as socket from './services/socket.js';

// --- App state ---
let currentUser = null;   // { id, username }
let currentGameId = null;
let currentRole = null;   // 'dm' | 'player'
let gamePlayers = [];     // [{ userId, username, role }] – all users in the game
let gameMap = null;
let players = [];
let activePlayer = null;
let authScreen = null;
let gameLobby = null;

// --- DOM containers ---
const authContainer = document.getElementById('auth-container');
const lobbyContainer = document.getElementById('lobby-container');
const gameContainer = document.getElementById('game-container');

// --- Boot: check existing session ---
function boot() {
  const user = getCurrentUser();
  if (user) {
    currentUser = user;
    showLobby();
  } else {
    showAuth();
  }
}

// --- Auth screen ---
function showAuth() {
  hideAll();
  authContainer.style.display = 'block';
  if (authScreen) authScreen.destroy();
  authScreen = new AuthScreen(authContainer, (user) => {
    currentUser = user;
    showLobby();
  });
}

// --- Game lobby ---
function showLobby() {
  hideAll();
  lobbyContainer.style.display = 'block';
  if (gameLobby) gameLobby.destroy();
  gameLobby = new GameLobby(
    lobbyContainer,
    currentUser,
    (game) => {
      currentGameId = game.id;
      currentRole = game.role;
      loadGame(game.id);
    },
    () => {
      // Logout
      logout();
      currentUser = null;
      showAuth();
    }
  );
}

// --- Load game and start ---
async function loadGame(gameId) {
  hideAll();
  gameContainer.style.display = 'block';

  try {
    const state = await getGameState(gameId);
    currentRole = state.my_role;

    // Store game player list (users, not characters) for chat DM targets
    gamePlayers = (state.players || []).map(p => ({
      userId: p.user_id,
      username: p.username,
      role: p.role,
    }));

    // Load map
    if (state.map_data) {
      gameMap = GameMap.fromJSON(state.map_data);
    } else {
      // New game – use demo map and save it
      gameMap = createDemoMap();
      if (currentRole === 'dm') {
        saveMapData(gameId, gameMap.toJSON()).catch(() => {});
      }
    }

    // Load characters
    players = state.characters.map(c => Player.fromServerData(c));

    // Select the user's first character, or first available
    const myChar = players.find(p => p.ownerId === currentUser.id);
    activePlayer = myChar || players[0] || null;

    initGameUI();
  } catch (err) {
    console.error('Failed to load game:', err);
    showLobby();
  }
}

function hideAll() {
  authContainer.style.display = 'none';
  lobbyContainer.style.display = 'none';
  gameContainer.style.display = 'none';
  stopGameLoop();
}

// --- Handle auth expiry ---
window.addEventListener('auth-expired', () => {
  currentUser = null;
  showAuth();
});

// ================================================================
// GAME UI (everything below runs after auth + game selection)
// ================================================================

let input = null;
let renderer2d = null;
let rendererFP = null;
let minimapRenderer = null;
let dmTools = null;
let roster = null;
let turnTracker = null;
let chatPanel = null;
let animFrameId = null;
let saveTimer = 0;

// --- Turn / Action Mode state ---
let actionModeEnabled = false;
let turnOrder = [];           // [characterId, ...]
let turnActiveIndex = -1;     // index into turnOrder

// --- Drag-and-drop state ---
let dragTarget = null;
let isDragging = false;
// --- Map pan-drag state ---
let isPanning = false;
let panLastX = 0;
let panLastY = 0;
let didPan = false;  // true if a pan-drag occurred — suppresses the next click
let yourTurnBanner = null;
let yourTurnTimeout = null;

function initGameUI() {
  // Clean up previous game session if any
  cleanup();

  input = new InputManager();

  // Canvases
  const canvas2d = document.getElementById('canvas-2d');
  const canvasFP = document.getElementById('canvas-fp');

  // Renderers
  renderer2d = new MapRenderer2D(canvas2d, gameMap);
  rendererFP = new RaycastRenderer(canvasFP, gameMap);

  // DM Tools – pass role so it can hide for non-DMs
  dmTools = new DMTools(
    document.getElementById('toolbar'),
    gameMap,
    renderer2d,
    currentRole,
    (enabled) => onActionModeToggle(enabled)
  );

  // Player Roster – pass user/role info for ownership restrictions
  roster = new PlayerRoster(
    document.getElementById('roster-container'),
    (player) => {
      // Only allow selecting characters the user can control
      if (canControl(player)) {
        activePlayer = player;
      }
    },
    (allPlayers) => { players = allPlayers; },
    currentUser,
    currentRole,
    currentGameId
  );

  // Load existing players into roster
  for (const p of players) {
    roster.addPlayer(p, true); // true = skip server create (already exists)
  }

  // Auto-select own character
  if (!activePlayer) {
    activePlayer = players.find(p => p.ownerId === currentUser.id) || players[0] || null;
  }
  if (activePlayer) roster.selectPlayer(activePlayer.id);

  // Turn Tracker (for both DM and players — DM gets controls, players see status)
  const turnTrackerContainer = document.getElementById('turn-tracker-container');
  turnTracker = new TurnTracker(
    turnTrackerContainer,
    players,
    currentUser,
    currentRole,
    (turnState) => {
      // DM changed turn state — update local + broadcast
      applyTurnState(turnState);
      socket.sendTurnUpdate(turnState);
    },
    (characterId, roll) => {
      // Player or DM submitted an initiative roll — broadcast
      socket.sendInitiativeRoll(characterId, roll);
    }
  );

  // Chat Panel
  chatPanel = new ChatPanel(
    document.getElementById('chat-container'),
    currentUser,
    gamePlayers,
    (content, recipientId) => {
      socket.sendChatMessage(content, recipientId);
    }
  );

  // Load chat history
  getMessages(currentGameId).then((data) => {
    if (data && data.messages && chatPanel) {
      // Normalize field names from REST (snake_case) to match WS format (camelCase)
      const normalized = data.messages.map(m => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        recipientId: m.recipient_id,
        content: m.content,
        createdAt: m.created_at,
      }));
      chatPanel.loadHistory(normalized);
    }
  }).catch((err) => {
    console.error('Failed to load chat history:', err);
  });

  // View state
  viewMode = '2d';
  minimapEnabled = true;

  // Minimap
  const minimapCanvas = document.getElementById('minimap');
  if (minimapCanvas) {
    minimapRenderer = new MapRenderer2D(minimapCanvas, gameMap);
    minimapRenderer.tileSize = 10;
    minimapRenderer.showGrid = false;
    minimapRenderer.wallThickness = 1;
  }

  // Scroll zoom
  renderer2d.setupScrollZoom();

  // Resize
  handleResize();
  window.addEventListener('resize', handleResize);

  // Centre camera on the player's character (or map centre for DM)
  if (activePlayer) {
    renderer2d.centreOn(activePlayer.x, activePlayer.y);
  } else {
    renderer2d.centreOn(gameMap.width / 2, gameMap.height / 2);
  }

  // View toggling
  setupViewToggling();

  // Click handling for DM tools
  canvas2d.addEventListener('click', onCanvasClick);

  // DM drag-and-drop on 2D canvas
  canvas2d.addEventListener('mousedown', onCanvasMouseDown);
  canvas2d.addEventListener('mousemove', onCanvasMouseMove);
  canvas2d.addEventListener('mouseup', onCanvasMouseUp);

  // Mouse look for first-person
  canvasFP.addEventListener('click', onFPClick);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);

  // Re-centre button
  const recenterBtn = document.getElementById('recenter-btn');
  if (recenterBtn) recenterBtn.addEventListener('click', recenterCamera);

  // Keyboard shortcuts
  window.addEventListener('keydown', onKeyDown);

  // Start game loop
  lastTime = 0;
  rosterRefreshTimer = 0;
  saveTimer = 0;
  animFrameId = requestAnimationFrame(gameLoop);

  updateCanvasVisibility();

  // --- WebSocket: connect and register handlers ---
  socket.connect(currentGameId);

  socket.onRemoteMove((msg) => {
    const player = players.find(p => p.characterId === msg.characterId);
    if (player) {
      player.x = msg.x;
      player.y = msg.y;
      player.angle = msg.angle;
    }
  });

  socket.onCharacterAdded((msg) => {
    // Don't add if we already have this character
    if (players.find(p => p.characterId === msg.character.id)) return;
    const player = Player.fromServerData(msg.character);
    if (roster) roster.addPlayer(player, true);
    if (turnTracker) turnTracker.setPlayers(players);
  });

  socket.onCharacterRemoved((msg) => {
    const player = players.find(p => p.characterId === msg.characterId);
    if (player && roster) {
      // Remove from local array directly (skip server delete — already deleted by the sender)
      const idx = roster.players.findIndex(p => p.characterId === msg.characterId);
      if (idx !== -1) {
        const removed = roster.players.splice(idx, 1)[0];
        if (roster.activePlayer === removed) {
          roster.activePlayer = roster.players.find(p => roster._canControl(p)) || null;
          roster.onSelect(roster.activePlayer);
        }
        roster.onPlayersChange(roster.players);
        roster._renderList();
      }
    }
    if (turnTracker) turnTracker.setPlayers(players);
  });

  // --- Turn update from server ---
  socket.onTurnUpdate((msg) => {
    applyTurnState(msg);
    if (turnTracker) turnTracker.setTurnState(msg);
    // If action mode was disabled remotely, update DMTools toggle
    if (!msg.enabled && dmTools) {
      dmTools.setActionMode(false);
    }
  });

  // --- DM drag from server ---
  socket.onDMDrag((msg) => {
    const player = players.find(p => p.characterId === msg.characterId);
    if (player) {
      player.x = msg.x;
      player.y = msg.y;
    }
  });

  // --- Initiative roll from server ---
  socket.onInitiativeRoll((msg) => {
    if (turnTracker) {
      turnTracker.setInitiativeRoll(msg.characterId, msg.roll);
    }
  });

  // --- Chat message from server ---
  socket.onChatMessage((msg) => {
    if (chatPanel) {
      chatPanel.addMessage(msg);
    }
  });
}

function cleanup() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = null;
  if (input) input.destroy();

  // Disconnect WebSocket
  socket.disconnect();
  socket.clearHandlers();

  // Remove event listeners
  window.removeEventListener('resize', handleResize);
  window.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('pointerlockchange', onPointerLockChange);
  document.removeEventListener('mousemove', onMouseMove);

  const canvas2d = document.getElementById('canvas-2d');
  const canvasFP = document.getElementById('canvas-fp');
  if (canvas2d) {
    canvas2d.removeEventListener('click', onCanvasClick);
    canvas2d.removeEventListener('mousedown', onCanvasMouseDown);
    canvas2d.removeEventListener('mousemove', onCanvasMouseMove);
    canvas2d.removeEventListener('mouseup', onCanvasMouseUp);
  }
  if (canvasFP) canvasFP.removeEventListener('click', onFPClick);

  const recenterBtn = document.getElementById('recenter-btn');
  if (recenterBtn) recenterBtn.removeEventListener('click', recenterCamera);

  // Clear roster, DM tools, turn tracker, and chat containers
  const toolbar = document.getElementById('toolbar');
  const rosterEl = document.getElementById('roster-container');
  const turnTrackerEl = document.getElementById('turn-tracker-container');
  const chatEl = document.getElementById('chat-container');
  if (toolbar) toolbar.innerHTML = '';
  if (rosterEl) rosterEl.innerHTML = '';
  if (turnTrackerEl) turnTrackerEl.innerHTML = '';
  if (chatEl) chatEl.innerHTML = '';

  // Clear "Your Turn" banner
  if (yourTurnBanner && yourTurnBanner.parentNode) {
    yourTurnBanner.parentNode.removeChild(yourTurnBanner);
  }
  yourTurnBanner = null;
  if (yourTurnTimeout) clearTimeout(yourTurnTimeout);

  // Reset turn state
  actionModeEnabled = false;
  turnOrder = [];
  turnActiveIndex = -1;
  dragTarget = null;
  isDragging = false;
  isPanning = false;
  didPan = false;

  renderer2d = null;
  rendererFP = null;
  minimapRenderer = null;
  dmTools = null;
  roster = null;
  turnTracker = null;
  chatPanel = null;
}

function stopGameLoop() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

/** Check if the current user can control a given player character. */
function canControl(player) {
  if (!player) return false;
  if (currentRole === 'dm') return true;            // DM always controls
  if (player.ownerId !== currentUser.id) return false; // Must own character

  // Action mode: only active-turn character can move
  if (actionModeEnabled && turnOrder.length > 0 && turnActiveIndex >= 0) {
    return player.characterId === turnOrder[turnActiveIndex];
  }
  return true;
}

// --- View state ---
let viewMode = '2d';
let minimapEnabled = true;
let isPointerLocked = false;

function setupViewToggling() {
  const viewButtons = document.querySelectorAll('.view-btn');
  viewButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      viewButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      viewMode = btn.dataset.view;
      updateCanvasVisibility();
    });
  });
}

function updateCanvasVisibility() {
  const canvas2d = document.getElementById('canvas-2d');
  const canvasFP = document.getElementById('canvas-fp');
  if (!canvas2d || !canvasFP) return;

  canvas2d.style.display = (viewMode === '2d' || viewMode === 'split') ? 'block' : 'none';
  canvasFP.style.display = (viewMode === 'fp' || viewMode === 'split') ? 'block' : 'none';

  if (viewMode === 'split') {
    canvas2d.style.width = '50%';
    canvasFP.style.width = '50%';
  } else {
    canvas2d.style.width = '100%';
    canvasFP.style.width = '100%';
  }

  handleResize();
}

function handleResize() {
  if (renderer2d) renderer2d.resize();
  if (rendererFP) rendererFP.resize();
  if (minimapRenderer) minimapRenderer.resize();
}

// --- Event handlers ---

function onCanvasClick(e) {
  // Don't fire DM tool clicks when drag tool is active, we just dragged, or we just panned
  if (isDragging) return;
  if (didPan) { didPan = false; return; }
  if (dmTools && dmTools.activeTool === 'drag') return;

  const canvas2d = document.getElementById('canvas-2d');
  const rect = canvas2d.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (dmTools) dmTools.handleClick(x, y);
}

function onFPClick() {
  const canvasFP = document.getElementById('canvas-fp');
  if (viewMode === 'fp' || viewMode === 'split') {
    canvasFP.requestPointerLock();
  }
}

function onPointerLockChange() {
  const canvasFP = document.getElementById('canvas-fp');
  isPointerLocked = document.pointerLockElement === canvasFP;
}

function onMouseMove(e) {
  if (isPointerLocked && activePlayer && canControl(activePlayer)) {
    activePlayer.angle += e.movementX * 0.003;
    // Broadcast angle change via WebSocket
    if (activePlayer.characterId) {
      socket.sendMove(activePlayer.characterId, activePlayer.x, activePlayer.y, activePlayer.angle);
    }
  }
}

function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.code === 'Tab') {
    e.preventDefault();
    const modes = ['2d', 'fp', 'split'];
    const idx = modes.indexOf(viewMode);
    viewMode = modes[(idx + 1) % modes.length];
    document.querySelectorAll('.view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === viewMode);
    });
    updateCanvasVisibility();
  }

  if (e.code === 'KeyM') {
    minimapEnabled = !minimapEnabled;
    const minimapCanvas = document.getElementById('minimap');
    if (minimapCanvas) minimapCanvas.style.display = minimapEnabled ? 'block' : 'none';
  }

  if (e.code === 'KeyC') {
    recenterCamera();
  }

  if (e.code === 'Escape' && isPointerLocked) {
    document.exitPointerLock();
  }

  // Number keys 1-9 to quick-switch active player (respects ownership)
  if (e.code.startsWith('Digit')) {
    const num = parseInt(e.code.replace('Digit', ''), 10);
    if (num >= 1 && num <= players.length) {
      const target = players[num - 1];
      if (canControl(target)) {
        if (roster) roster.selectPlayer(target.id);
        activePlayer = target;
      }
    }
  }

  // Ctrl+B to go back to lobby
  if (e.code === 'KeyB' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    showLobby();
  }
}

// --- Action Mode & Turn Management ---

/** Called when DM toggles Action Mode on/off in DMTools. */
function onActionModeToggle(enabled) {
  actionModeEnabled = enabled;
  if (turnTracker) {
    turnTracker.enabled = enabled;
    turnTracker.setVisible(enabled);
    if (enabled) {
      turnTracker.setPlayers(players);
    } else {
      // Disable action mode — clear turn state and broadcast
      turnOrder = [];
      turnActiveIndex = -1;
      turnTracker.setTurnState({ enabled: false, order: [], activeIndex: -1 });
      turnTracker.clearInitiativeRolls();
      socket.sendTurnUpdate({ enabled: false, order: [], activeIndex: -1 });
    }
  }
}

/** Apply a turn state (from local DM action or remote WebSocket). */
function applyTurnState(state) {
  const wasMyTurn = isMyTurn();
  actionModeEnabled = state.enabled;
  turnOrder = state.order || [];
  turnActiveIndex = typeof state.activeIndex === 'number' ? state.activeIndex : -1;

  if (!actionModeEnabled) {
    turnOrder = [];
    turnActiveIndex = -1;
  }

  // Show "Your Turn!" notification if it just became this player's turn
  if (actionModeEnabled && !wasMyTurn && isMyTurn()) {
    showYourTurnBanner();
  }
}

/** Check if it's the current user's turn. */
function isMyTurn() {
  if (!actionModeEnabled || turnOrder.length === 0 || turnActiveIndex < 0) return false;
  const activeCharId = turnOrder[turnActiveIndex];
  const activeP = players.find(p => p.characterId === activeCharId);
  return activeP && activeP.ownerId === currentUser.id;
}

/** Show a "Your Turn!" banner that fades after 2 seconds. */
function showYourTurnBanner() {
  if (yourTurnTimeout) clearTimeout(yourTurnTimeout);
  if (yourTurnBanner && yourTurnBanner.parentNode) {
    yourTurnBanner.parentNode.removeChild(yourTurnBanner);
  }

  yourTurnBanner = document.createElement('div');
  yourTurnBanner.className = 'your-turn-banner';
  yourTurnBanner.textContent = 'Your Turn!';
  const viewport = document.getElementById('viewport');
  if (viewport) viewport.appendChild(yourTurnBanner);

  // Trigger animation
  requestAnimationFrame(() => {
    yourTurnBanner.classList.add('show');
  });

  yourTurnTimeout = setTimeout(() => {
    if (yourTurnBanner) {
      yourTurnBanner.classList.remove('show');
      yourTurnBanner.classList.add('fade-out');
      setTimeout(() => {
        if (yourTurnBanner && yourTurnBanner.parentNode) {
          yourTurnBanner.parentNode.removeChild(yourTurnBanner);
        }
        yourTurnBanner = null;
      }, 500);
    }
  }, 2000);
}

/** Re-centre the 2D camera on the active player (or first player for DM). */
function recenterCamera() {
  if (!renderer2d) return;
  const target = activePlayer || players[0];
  if (target) {
    renderer2d.centreOn(target.x, target.y);
  }
}

// --- Drag-and-Drop handlers ---

function onCanvasMouseDown(e) {
  if (e.button !== 0) return; // left click only

  const canvas2d = document.getElementById('canvas-2d');
  const rect = canvas2d.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const world = renderer2d.screenToWorld(screenX, screenY);

  // Hit-test players — DM can drag any, players can drag their own
  for (const player of players) {
    const dx = world.x - player.x;
    const dy = world.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.4 && canControl(player)) {
      dragTarget = player;
      isDragging = true;
      canvas2d.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
  }

  // No player hit — start panning the map
  isPanning = true;
  panLastX = e.clientX;
  panLastY = e.clientY;
  canvas2d.style.cursor = 'grab';
  e.preventDefault();
}

function onCanvasMouseMove(e) {
  // Map pan-drag
  if (isPanning && renderer2d) {
    const dx = e.clientX - panLastX;
    const dy = e.clientY - panLastY;
    if (dx !== 0 || dy !== 0) didPan = true;
    renderer2d.panBy(-dx, -dy);
    panLastX = e.clientX;
    panLastY = e.clientY;
    return;
  }

  if (!isDragging || !dragTarget || !renderer2d) return;

  const canvas2d = document.getElementById('canvas-2d');
  const rect = canvas2d.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const world = renderer2d.screenToWorld(screenX, screenY);

  // Clamp to map bounds (keep a small margin so the token stays fully inside)
  const margin = 0.3;
  const clampedX = Math.max(margin, Math.min(gameMap.width - margin, world.x));
  const clampedY = Math.max(margin, Math.min(gameMap.height - margin, world.y));

  dragTarget.x = clampedX;
  dragTarget.y = clampedY;

  // Broadcast drag position — DM uses dm_drag, players use regular move
  if (dragTarget.characterId) {
    if (currentRole === 'dm') {
      socket.sendDMDrag(dragTarget.characterId, clampedX, clampedY);
    } else {
      socket.sendMove(dragTarget.characterId, clampedX, clampedY, dragTarget.angle);
    }
  }
}

function onCanvasMouseUp() {
  const canvas2d = document.getElementById('canvas-2d');

  // End map pan
  if (isPanning) {
    isPanning = false;
    if (canvas2d) canvas2d.style.cursor = '';
    return;
  }

  if (!isDragging || !dragTarget) {
    isDragging = false;
    dragTarget = null;
    return;
  }

  // Save final position
  if (dragTarget.characterId) {
    updateCharacter(dragTarget.characterId, {
      x: dragTarget.x,
      y: dragTarget.y,
      angle: dragTarget.angle,
    }).catch(() => {});
  }

  isDragging = false;
  dragTarget = null;
  if (canvas2d) canvas2d.style.cursor = '';
}

// --- Game loop ---
let lastTime = 0;
let rosterRefreshTimer = 0;

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  // --- Input ---
  if (input) {
    // WASD pans the 2D camera, QE zooms in/out — for everyone
    if (renderer2d && (viewMode === '2d' || viewMode === 'split')) {
      const panSpeed = 400; // pixels per second
      if (input.isDown('KeyW')) renderer2d.panBy(0, -panSpeed * dt);
      if (input.isDown('KeyS')) renderer2d.panBy(0, panSpeed * dt);
      if (input.isDown('KeyA')) renderer2d.panBy(-panSpeed * dt, 0);
      if (input.isDown('KeyD')) renderer2d.panBy(panSpeed * dt, 0);

      // QE zoom — zoom toward/away from canvas centre
      const zoomRate = 1.5; // per second
      if (input.isDown('KeyQ') || input.isDown('KeyE')) {
        const dir = input.isDown('KeyQ') ? -1 : 1;
        const oldZoom = renderer2d.camera.zoom;
        const newZoom = Math.min(
          renderer2d.zoomMax,
          Math.max(renderer2d.zoomMin, oldZoom * (1 + dir * zoomRate * dt))
        );
        // Zoom toward canvas centre so the view stays centred
        const rect = renderer2d.canvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const worldBefore = renderer2d.screenToWorld(cx, cy);
        renderer2d.camera.zoom = newZoom;
        const newTs = renderer2d.tileSize * newZoom;
        renderer2d.camera.x = worldBefore.x * newTs - cx;
        renderer2d.camera.y = worldBefore.y * newTs - cy;
      }
    }

    // Arrow keys move the active character (players only — DM has no character)
    if (currentRole !== 'dm' && activePlayer && canControl(activePlayer)) {
      const prevX = activePlayer.x;
      const prevY = activePlayer.y;
      const prevAngle = activePlayer.angle;

      if (input.isDown('ArrowUp'))    activePlayer.move(1, dt, gameMap);
      if (input.isDown('ArrowDown'))  activePlayer.move(-1, dt, gameMap);
      if (input.isDown('ArrowLeft'))  {
        if (viewMode === 'fp' || isPointerLocked) {
          activePlayer.strafe(-1, dt, gameMap);
        } else {
          activePlayer.turn(-1, dt);
        }
      }
      if (input.isDown('ArrowRight')) {
        if (viewMode === 'fp' || isPointerLocked) {
          activePlayer.strafe(1, dt, gameMap);
        } else {
          activePlayer.turn(1, dt);
        }
      }
      // Broadcast position if it changed
      if (activePlayer.characterId &&
          (activePlayer.x !== prevX || activePlayer.y !== prevY || activePlayer.angle !== prevAngle)) {
        socket.sendMove(activePlayer.characterId, activePlayer.x, activePlayer.y, activePlayer.angle);
      }
    }
  }

  // --- Render ---
  const turnActiveCharId = (actionModeEnabled && turnOrder.length > 0 && turnActiveIndex >= 0)
    ? turnOrder[turnActiveIndex]
    : null;

  if (activePlayer) {
    if (viewMode === '2d' || viewMode === 'split') {
      renderer2d.draw(players, activePlayer, actionModeEnabled, turnActiveCharId);
    }

    if (viewMode === 'fp' || viewMode === 'split') {
      rendererFP.draw(activePlayer, players);
    }

    // Minimap overlay (shown in FP mode)
    const minimapCanvas = document.getElementById('minimap');
    if (minimapRenderer && minimapEnabled && viewMode === 'fp') {
      minimapRenderer.centreOn(activePlayer.x, activePlayer.y);
      minimapRenderer.draw(players, activePlayer);
    }
    if (minimapCanvas) {
      minimapCanvas.style.display = (minimapEnabled && viewMode === 'fp') ? 'block' : 'none';
    }
  }

  // Refresh roster position display periodically
  rosterRefreshTimer += dt;
  if (rosterRefreshTimer > 0.25) {
    rosterRefreshTimer = 0;
    if (roster) roster.refreshPositions();
  }

  // Auto-save character positions every 3 seconds
  saveTimer += dt;
  if (saveTimer > 3) {
    saveTimer = 0;
    autoSavePositions();
  }

  animFrameId = requestAnimationFrame(gameLoop);
}

/** Save all characters owned by the current user (or all if DM). */
function autoSavePositions() {
  for (const p of players) {
    if (!p.characterId) continue;
    if (currentRole === 'dm' || p.ownerId === currentUser.id) {
      updateCharacter(p.characterId, {
        x: p.x,
        y: p.y,
        angle: p.angle,
      }).catch(() => {}); // silent fail on save
    }
  }
}

// Save on page unload
window.addEventListener('beforeunload', () => {
  for (const p of players) {
    if (!p.characterId) continue;
    if (currentRole === 'dm' || (currentUser && p.ownerId === currentUser.id)) {
      const data = JSON.stringify({ x: p.x, y: p.y, angle: p.angle });
      navigator.sendBeacon(
        `/api/characters/${p.characterId}`,
        new Blob([data], { type: 'application/json' })
      );
    }
  }
});

// --- Kick off ---
boot();
