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
import { MapCreator } from './ui/MapCreator.js';
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
let mapCreator = null;

// --- DOM containers ---
const authContainer = document.getElementById('auth-container');
const lobbyContainer = document.getElementById('lobby-container');
const gameContainer = document.getElementById('game-container');
const mapCreatorContainer = document.getElementById('map-creator-container');

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
    },
    (game) => {
      // Edit Map — fetch game state then open editor
      currentGameId = game.id;
      currentRole = 'dm';
      getGameState(game.id).then(state => {
        showMapCreator(game.id, state.map_data);
      }).catch(err => {
        console.error('Failed to load game for map editing:', err);
      });
    }
  );
}

// --- Map Creator ---
function showMapCreator(gameId, existingMapData) {
  hideAll();
  mapCreatorContainer.style.display = 'block';

  const existingMap = existingMapData ? GameMap.fromJSON(existingMapData) : null;

  mapCreator = new MapCreator(
    mapCreatorContainer,
    existingMap,
    (mapData) => {
      // Save map to server then go to the game
      saveMapData(gameId, mapData).then(() => {
        loadGame(gameId);
      }).catch(err => {
        console.error('Failed to save map:', err);
        alert('Failed to save map.');
      });
    },
    () => {
      // Cancel — go back to lobby
      showLobby();
    }
  );
}

// --- In-game Map Library ---
function openMapLibraryInGame() {
  if (mapLibraryInstance) return; // already open

  mapLibraryInstance = new MapLibrary(
    gameContainer,
    (mapData) => {
      // Load the selected map into the current game
      saveMapData(currentGameId, mapData).then(() => {
        mapLibraryInstance.destroy();
        mapLibraryInstance = null;
        loadGame(currentGameId);
      }).catch(err => {
        console.error('Failed to apply map:', err);
        alert('Failed to apply map to game.');
      });
    },
    () => {
      if (mapLibraryInstance) {
        mapLibraryInstance.destroy();
        mapLibraryInstance = null;
      }
    },
    null // load-only mode from in-game
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
  mapCreatorContainer.style.display = 'none';
  stopGameLoop();
  // Destroy map creator if open
  if (mapCreator) {
    mapCreator.destroy();
    mapCreator = null;
  }
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

// --- Movement budget tracking (D&D movement speed enforcement) ---
let turnDistanceMoved = {};   // { [characterId]: number } – cells moved this turn
let turnStartPositions = {};  // { [characterId]: { x, y } } – where each character started their turn
let turnBreadcrumbs = {};     // { [characterId]: [{x, y}, ...] } – breadcrumb path waypoints
let movementLockedIn = {};    // { [characterId]: boolean } – true once player locks in movement
let lockInBtn = null;         // DOM element for the "Lock In" button

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
    (enabled) => onActionModeToggle(enabled),
    () => showMapCreator(currentGameId, gameMap.toJSON())
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
    currentGameId,
    {
      isCircleVisible: (charId) => isCircleVisible(charId),
      toggleCharacterCircle: (charId) => toggleCharacterCircle(charId),
    }
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
    },
    (sortedCharIds) => {
      // DM sorted initiative order — broadcast to all clients
      socket.sendInitiativeSort(sortedCharIds);
    }
  );

  // Chat Panel
  chatPanel = new ChatPanel(
    document.getElementById('chat-container'),
    currentUser,
    gamePlayers,
    (content, recipientId, roll) => {
      socket.sendChatMessage(content, recipientId, roll);
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

  // Movement range toggle button
  _createRangeToggleBtn();

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
    console.log('[main] onTurnUpdate received:', JSON.stringify(msg));
    applyTurnState(msg);
    if (turnTracker) {
      // When action mode is first enabled, ensure tracker has current player list
      if (msg.enabled && !turnTracker.enabled) {
        console.log('[main] first enable — refreshing tracker players');
        turnTracker.setPlayers(players);
      }
      turnTracker.setTurnState(msg);
    }
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

  // --- Initiative sort from server ---
  socket.onInitiativeSort((msg) => {
    console.log('[main] onInitiativeSort received:', JSON.stringify(msg));
    if (turnTracker && msg.sortedCharIds) {
      turnTracker.applySortOrder(msg.sortedCharIds);
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
  turnDistanceMoved = {};
  turnStartPositions = {};
  turnBreadcrumbs = {};
  movementLockedIn = {};
  movementCircleVisible = {};
  // Remove lock-in button entirely
  if (lockInBtn && lockInBtn.parentNode) {
    lockInBtn.parentNode.removeChild(lockInBtn);
  }
  lockInBtn = null;
  // Remove range toggle button
  if (rangeToggleBtn && rangeToggleBtn.parentNode) {
    rangeToggleBtn.parentNode.removeChild(rangeToggleBtn);
  }
  rangeToggleBtn = null;
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
// Movement circle visibility – per-character for DM, single toggle for players
// { [characterId]: boolean }  – if a characterId is absent, defaults to true
let movementCircleVisible = {};
let showMovementCircleGlobal = true;  // player's own toggle (also used as DM "all" default)

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

  if (e.code === 'KeyR') {
    _toggleAllRangeCircles();
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
      // Broadcast to players so they see the initiative tracker and can enter rolls
      socket.sendTurnUpdate({ enabled: true, order: [], activeIndex: -1 });
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
  const prevActiveCharId = (actionModeEnabled && turnOrder.length > 0 && turnActiveIndex >= 0)
    ? turnOrder[turnActiveIndex] : null;

  actionModeEnabled = state.enabled;
  turnOrder = state.order || [];
  turnActiveIndex = typeof state.activeIndex === 'number' ? state.activeIndex : -1;

  if (!actionModeEnabled) {
    turnOrder = [];
    turnActiveIndex = -1;
    turnDistanceMoved = {};
    turnStartPositions = {};
    turnBreadcrumbs = {};
    movementLockedIn = {};
    _hideLockInBtn();
  }

  // Reset movement budget and record start position when active turn changes
  const newActiveCharId = (actionModeEnabled && turnOrder.length > 0 && turnActiveIndex >= 0)
    ? turnOrder[turnActiveIndex] : null;
  if (newActiveCharId && newActiveCharId !== prevActiveCharId) {
    turnDistanceMoved[newActiveCharId] = 0;
    movementLockedIn[newActiveCharId] = false;
    // Record where this character starts their turn (circle stays here)
    const turnPlayer = players.find(p => p.characterId === newActiveCharId);
    if (turnPlayer) {
      turnStartPositions[newActiveCharId] = { x: turnPlayer.x, y: turnPlayer.y };
      turnBreadcrumbs[newActiveCharId] = [{ x: turnPlayer.x, y: turnPlayer.y }];
    }
    // Show/hide lock-in button based on whether it's our turn
    _updateLockInBtn();
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

// --- Lock In Movement button ---

/** Show or hide the Lock In button based on whether it's the current user's turn. */
function _updateLockInBtn() {
  if (!actionModeEnabled) { _hideLockInBtn(); return; }

  const activeCharId = (turnOrder.length > 0 && turnActiveIndex >= 0)
    ? turnOrder[turnActiveIndex] : null;
  if (!activeCharId) { _hideLockInBtn(); return; }

  const activeP = players.find(p => p.characterId === activeCharId);
  const isOwner = activeP && activeP.ownerId === currentUser.id;
  const isDM = currentRole === 'dm';

  // Show for the player whose turn it is (or the DM)
  if ((isOwner || isDM) && !movementLockedIn[activeCharId]) {
    _showLockInBtn();
  } else {
    _hideLockInBtn();
  }
}

function _showLockInBtn() {
  if (lockInBtn) { lockInBtn.style.display = 'flex'; return; }

  lockInBtn = document.createElement('button');
  lockInBtn.className = 'lock-in-btn';
  lockInBtn.textContent = 'Lock In Movement';
  lockInBtn.addEventListener('click', _onLockInMovement);

  const viewport = document.getElementById('viewport');
  if (viewport) viewport.appendChild(lockInBtn);
}

function _hideLockInBtn() {
  if (lockInBtn) {
    lockInBtn.style.display = 'none';
  }
}

function _onLockInMovement() {
  const activeCharId = (turnOrder.length > 0 && turnActiveIndex >= 0)
    ? turnOrder[turnActiveIndex] : null;
  if (!activeCharId) return;

  movementLockedIn[activeCharId] = true;
  _hideLockInBtn();

  // Add final position to breadcrumbs
  const turnPlayer = players.find(p => p.characterId === activeCharId);
  if (turnPlayer && turnBreadcrumbs[activeCharId]) {
    const crumbs = turnBreadcrumbs[activeCharId];
    const last = crumbs[crumbs.length - 1];
    if (last.x !== turnPlayer.x || last.y !== turnPlayer.y) {
      crumbs.push({ x: turnPlayer.x, y: turnPlayer.y });
    }
  }
}

// --- Range Circle Toggle button ---
let rangeToggleBtn = null;

/** Check if a specific character's movement circle should be visible. */
function isCircleVisible(characterId) {
  if (characterId in movementCircleVisible) return movementCircleVisible[characterId];
  return showMovementCircleGlobal;
}

/** Toggle visibility for a single character's range circle. */
function toggleCharacterCircle(characterId) {
  const current = isCircleVisible(characterId);
  movementCircleVisible[characterId] = !current;
  _updateRangeToggleBtn();
  // Re-render roster to update eye icons
  if (roster) roster._renderList();
}

/** Toggle all range circles on/off (keyboard shortcut R, or DM "All" button). */
function _toggleAllRangeCircles() {
  showMovementCircleGlobal = !showMovementCircleGlobal;
  // Reset per-character overrides so they all follow the global toggle
  movementCircleVisible = {};
  _updateRangeToggleBtn();
  // Re-render roster to update eye icons
  if (roster) roster._renderList();
}

function _createRangeToggleBtn() {
  if (rangeToggleBtn) return;
  rangeToggleBtn = document.createElement('button');
  rangeToggleBtn.className = 'range-toggle-btn';
  rangeToggleBtn.addEventListener('click', () => {
    _toggleAllRangeCircles();
  });
  _updateRangeToggleBtn();
  const viewport = document.getElementById('viewport');
  if (viewport) viewport.appendChild(rangeToggleBtn);
}

function _updateRangeToggleBtn() {
  if (!rangeToggleBtn) return;
  // Check if any circles are visible
  const anyVisible = players.some(p => p.characterId && isCircleVisible(p.characterId))
    || showMovementCircleGlobal;
  rangeToggleBtn.textContent = anyVisible ? '◎ Range' : '○ Range';
  rangeToggleBtn.classList.toggle('active', anyVisible);
  rangeToggleBtn.title = `${anyVisible ? 'Hide' : 'Show'} all movement ranges (R)`;
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

      // In action mode, movement is blocked once locked in (but free to roam before locking)
      let canMove = true;
      if (actionModeEnabled && activePlayer.characterId) {
        if (movementLockedIn[activePlayer.characterId]) {
          canMove = false; // movement locked in — can't move until next turn
        }
      }

      if (canMove) {
        if (input.isDown('ArrowUp'))    activePlayer.move(1, dt, gameMap);
        if (input.isDown('ArrowDown'))  activePlayer.move(-1, dt, gameMap);
      }

      // Turning is always free (D&D rule), strafing consumes movement
      if (input.isDown('ArrowLeft'))  {
        if (viewMode === 'fp' || isPointerLocked) {
          if (canMove) activePlayer.strafe(-1, dt, gameMap);
        } else {
          activePlayer.turn(-1, dt);
        }
      }
      if (input.isDown('ArrowRight')) {
        if (viewMode === 'fp' || isPointerLocked) {
          if (canMove) activePlayer.strafe(1, dt, gameMap);
        } else {
          activePlayer.turn(1, dt);
        }
      }

      // Accumulate distance moved and record breadcrumb path
      if (actionModeEnabled && activePlayer.characterId) {
        const movedDx = activePlayer.x - prevX;
        const movedDy = activePlayer.y - prevY;
        const frameDist = Math.sqrt(movedDx * movedDx + movedDy * movedDy);
        if (frameDist > 0.001) {
          turnDistanceMoved[activePlayer.characterId] =
            (turnDistanceMoved[activePlayer.characterId] || 0) + frameDist;

          // Add breadcrumb waypoint (sample every ~0.15 cells to avoid excessive points)
          const crumbs = turnBreadcrumbs[activePlayer.characterId];
          if (crumbs) {
            const last = crumbs[crumbs.length - 1];
            const dxC = activePlayer.x - last.x;
            const dyC = activePlayer.y - last.y;
            if (Math.sqrt(dxC * dxC + dyC * dyC) > 0.15) {
              crumbs.push({ x: activePlayer.x, y: activePlayer.y });
            }
          }
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

  // Compute movement data for range circle overlays + breadcrumb paths.
  // DM sees circles for ALL players simultaneously; regular players see only the active turn.
  // In action mode: circle is STATIONARY at turn start position with full radius,
  //   breadcrumb path shows the route taken, distance accumulates continuously
  // In free mode: circle follows characters at full radius (no breadcrumbs)
  let allMovementData = [];

  /** Build a movementData entry for a given player character. */
  function _buildMovementEntry(p) {
    if (!p || !p.characterId || p.dndSpeedCells <= 0) return null;
    const charId = p.characterId;
    // Check per-character visibility
    if (!isCircleVisible(charId)) return null;

    if (actionModeEnabled && turnStartPositions[charId]) {
      // Action mode with turn data: circle at turn start, breadcrumb trail
      const moved = turnDistanceMoved[charId] || 0;
      const totalCells = p.dndSpeedCells;
      const remaining = Math.max(0, totalCells - moved);
      const startPos = turnStartPositions[charId];
      const crumbs = turnBreadcrumbs[charId] || [];
      const locked = movementLockedIn[charId] || false;
      return {
        characterId: charId,
        remainingCells: remaining,
        totalCells,
        remainingFeet: Math.round(remaining * 5),
        totalFeet: p.dndSpeed,
        movedFeet: Math.round(moved * 5),
        overBudget: moved > totalCells,
        startX: startPos.x,
        startY: startPos.y,
        breadcrumbs: crumbs,
        lockedIn: locked,
        playerColor: p.color,
      };
    }
    // Free mode, or action mode without turn data (not this character's turn):
    // show full range circle centred on current position
    return {
      characterId: charId,
      remainingCells: p.dndSpeedCells,
      totalCells: p.dndSpeedCells,
      remainingFeet: p.dndSpeed,
      totalFeet: p.dndSpeed,
      movedFeet: 0,
      overBudget: false,
      startX: p.x,
      startY: p.y,
      breadcrumbs: [],
      lockedIn: false,
      playerColor: p.color,
    };
  }

  if (currentRole === 'dm') {
    // DM sees all players' circles simultaneously
    for (const p of players) {
      const entry = _buildMovementEntry(p);
      if (entry) allMovementData.push(entry);
    }
  } else if (actionModeEnabled && turnActiveCharId) {
    // Regular player in action mode: only the active turn character
    const turnPlayer = players.find(p => p.characterId === turnActiveCharId);
    const entry = _buildMovementEntry(turnPlayer);
    if (entry) allMovementData.push(entry);
  } else if (!actionModeEnabled && activePlayer) {
    // Regular player in free mode: only their selected character
    const entry = _buildMovementEntry(activePlayer);
    if (entry) allMovementData.push(entry);
  }

  // Primary movement data (for HUD bar in first-person) — the active turn character's data
  const primaryMovementData = allMovementData.find(d => d.characterId === turnActiveCharId)
    || allMovementData[0] || null;

  if (activePlayer) {
    if (viewMode === '2d' || viewMode === 'split') {
      renderer2d.draw(players, activePlayer, actionModeEnabled, turnActiveCharId, allMovementData);
    }

    if (viewMode === 'fp' || viewMode === 'split') {
      rendererFP.draw(activePlayer, players, allMovementData, primaryMovementData);
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
