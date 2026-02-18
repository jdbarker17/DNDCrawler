/**
 * Main application entry point.
 * Wires together the map, players, both renderers, input, DM tools, and game loop.
 */

import { createDemoMap } from './engine/DemoMap.js';
import { Player } from './engine/Player.js';
import { InputManager } from './engine/InputManager.js';
import { MapRenderer2D } from './renderers/MapRenderer2D.js';
import { RaycastRenderer } from './renderers/RaycastRenderer.js';
import { DMTools } from './ui/DMTools.js';
import { PlayerRoster } from './ui/PlayerRoster.js';

// --- Setup ---
const gameMap = createDemoMap();
let players = [];
let activePlayer = null;

const input = new InputManager();

// Canvases
const canvas2d = document.getElementById('canvas-2d');
const canvasFP = document.getElementById('canvas-fp');

// Renderers
const renderer2d = new MapRenderer2D(canvas2d, gameMap);
const rendererFP = new RaycastRenderer(canvasFP, gameMap);

// DM Tools
const dmTools = new DMTools(document.getElementById('toolbar'), gameMap, renderer2d);

// Player Roster
const roster = new PlayerRoster(
  document.getElementById('roster-container'),
  (player) => { activePlayer = player; },       // onSelect
  (allPlayers) => { players = allPlayers; },     // onPlayersChange
);

// Seed initial party
function seedParty() {
  const starters = [
    { name: 'Thorin', className: 'Fighter', color: '#e74c3c', token: '\u{1F6E1}\uFE0F', x: 2.5, y: 1.5 },
    { name: 'Elara', className: 'Wizard', color: '#9b59b6', token: '\u{1FA84}', x: 3.5, y: 1.5 },
    { name: 'Finn', className: 'Rogue', color: '#2ecc71', token: '\u{1F5E1}\uFE0F', x: 2.5, y: 2.5 },
    { name: 'Sera', className: 'Cleric', color: '#f1c40f', token: '\u2728', x: 3.5, y: 2.5 },
  ];
  for (const s of starters) {
    const p = new Player(s.x, s.y, 0);
    p.name = s.name;
    p.className = s.className;
    p.color = s.color;
    p.token = s.token;
    roster.addPlayer(p);
  }
}
seedParty();

// View state
let viewMode = '2d'; // '2d' | 'fp' | 'split'
let minimapEnabled = true;

// --- View toggling ---
const viewButtons = document.querySelectorAll('.view-btn');
viewButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    viewButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    viewMode = btn.dataset.view;
    updateCanvasVisibility();
  });
});

function updateCanvasVisibility() {
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

// --- Minimap (drawn on a small offscreen canvas overlaid on the FP view) ---
const minimapCanvas = document.getElementById('minimap');
let minimapRenderer = null;
if (minimapCanvas) {
  minimapRenderer = new MapRenderer2D(minimapCanvas, gameMap);
  minimapRenderer.tileSize = 10;
  minimapRenderer.showGrid = false;
  minimapRenderer.wallThickness = 1;
}

// --- Scroll zoom on 2D canvas ---
renderer2d.setupScrollZoom();

// --- Resize handling ---
function handleResize() {
  renderer2d.resize();
  rendererFP.resize();
  if (minimapRenderer) minimapRenderer.resize();
}
window.addEventListener('resize', handleResize);
handleResize();

// --- Mouse / click handling for DM tools ---
canvas2d.addEventListener('click', (e) => {
  const rect = canvas2d.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  dmTools.handleClick(x, y);
});

// --- Mouse look for first-person view ---
let isPointerLocked = false;

canvasFP.addEventListener('click', () => {
  if (viewMode === 'fp' || viewMode === 'split') {
    canvasFP.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === canvasFP;
});

document.addEventListener('mousemove', (e) => {
  if (isPointerLocked && activePlayer) {
    activePlayer.angle += e.movementX * 0.003;
  }
});

// --- Keyboard shortcuts ---
window.addEventListener('keydown', (e) => {
  // Don't capture keys when typing in input fields
  if (e.target.tagName === 'INPUT') return;

  if (e.code === 'Tab') {
    e.preventDefault();
    // Cycle view modes
    const modes = ['2d', 'fp', 'split'];
    const idx = modes.indexOf(viewMode);
    viewMode = modes[(idx + 1) % modes.length];
    viewButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.view === viewMode);
    });
    updateCanvasVisibility();
  }
  if (e.code === 'KeyM') {
    minimapEnabled = !minimapEnabled;
    if (minimapCanvas) minimapCanvas.style.display = minimapEnabled ? 'block' : 'none';
  }
  if (e.code === 'Escape' && isPointerLocked) {
    document.exitPointerLock();
  }

  // Number keys 1-9 to quick-switch active player
  if (e.code.startsWith('Digit')) {
    const num = parseInt(e.code.replace('Digit', ''), 10);
    if (num >= 1 && num <= players.length) {
      roster.selectPlayer(players[num - 1].id);
    }
  }
});

// --- Game loop ---
let lastTime = 0;
let rosterRefreshTimer = 0;

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap delta at 50ms
  lastTime = timestamp;

  // --- Input (applied to active player) ---
  if (activePlayer) {
    if (input.isDown('KeyW') || input.isDown('ArrowUp'))    activePlayer.move(1, dt, gameMap);
    if (input.isDown('KeyS') || input.isDown('ArrowDown'))  activePlayer.move(-1, dt, gameMap);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft'))   {
      if (viewMode === 'fp' || isPointerLocked) {
        activePlayer.strafe(-1, dt, gameMap);
      } else {
        activePlayer.turn(-1, dt);
      }
    }
    if (input.isDown('KeyD') || input.isDown('ArrowRight'))  {
      if (viewMode === 'fp' || isPointerLocked) {
        activePlayer.strafe(1, dt, gameMap);
      } else {
        activePlayer.turn(1, dt);
      }
    }
    if (input.isDown('KeyQ')) activePlayer.turn(-1, dt);
    if (input.isDown('KeyE')) activePlayer.turn(1, dt);
  }

  // --- Render ---
  if (activePlayer) {
    if (viewMode === '2d' || viewMode === 'split') {
      renderer2d.centreOn(activePlayer.x, activePlayer.y);
      renderer2d.draw(players, activePlayer);
    }

    if (viewMode === 'fp' || viewMode === 'split') {
      rendererFP.draw(activePlayer, players);
    }

    // Minimap overlay (shown in FP mode)
    if (minimapRenderer && minimapEnabled && (viewMode === 'fp')) {
      minimapRenderer.centreOn(activePlayer.x, activePlayer.y);
      minimapRenderer.draw(players, activePlayer);
    }
    if (minimapCanvas) {
      minimapCanvas.style.display = (minimapEnabled && viewMode === 'fp') ? 'block' : 'none';
    }
  }

  // Refresh roster position display periodically (not every frame)
  rosterRefreshTimer += dt;
  if (rosterRefreshTimer > 0.25) {
    rosterRefreshTimer = 0;
    roster.refreshPositions();
  }

  requestAnimationFrame(gameLoop);
}

// Kick off
updateCanvasVisibility();
requestAnimationFrame(gameLoop);
