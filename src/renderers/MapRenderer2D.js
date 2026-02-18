/**
 * 2D top-down map renderer.
 * Draws the grid, walls, player token, objects, and a fog-of-war overlay.
 */

import { WALL_N, WALL_S, WALL_E, WALL_W } from '../engine/GameMap.js';

export class MapRenderer2D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../engine/GameMap.js').GameMap} gameMap
   */
  constructor(canvas, gameMap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gameMap = gameMap;
    this.tileSize = 40; // pixels per cell

    // Camera (pan + zoom)
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.zoomMin = 0.3;
    this.zoomMax = 4;
    this.zoomSpeed = 0.1;

    // Grid display
    this.showGrid = true;
    this.gridColor = 'rgba(255,255,255,0.08)';
    this.wallThickness = 3;
    this.wallColor = '#d4c9a8';

    // Solid-block fill colour
    this.solidColor = '#111';
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Centre the camera on a world position. */
  centreOn(worldX, worldY) {
    const rect = this.canvas.getBoundingClientRect();
    this.camera.x = worldX * this.tileSize * this.camera.zoom - rect.width / 2;
    this.camera.y = worldY * this.tileSize * this.camera.zoom - rect.height / 2;
  }

  /**
   * Main draw call.
   * @param {import('../engine/Player.js').Player[]} players
   * @param {import('../engine/Player.js').Player} activePlayer – the one whose view we're rendering
   */
  draw(players, activePlayer) {
    const { ctx, gameMap, tileSize, camera } = this;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const z = camera.zoom;
    const ts = tileSize * z;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // --- Floor tiles and solid blocks ---
    for (let y = 0; y < gameMap.height; y++) {
      for (let x = 0; x < gameMap.width; x++) {
        const cell = gameMap.cells[y][x];
        const px = x * ts;
        const py = y * ts;

        if (cell.solid) {
          // Solid rock – draw as a filled dark block
          ctx.fillStyle = this.solidColor;
          ctx.fillRect(px, py, ts, ts);
        } else {
          // Passable floor
          ctx.fillStyle = cell.floorColor;
          ctx.globalAlpha = Math.max(0.15, cell.light);
          ctx.fillRect(px, py, ts, ts);
          ctx.globalAlpha = 1;
        }
      }
    }

    // --- Grid (only over non-solid cells) ---
    if (this.showGrid) {
      ctx.strokeStyle = this.gridColor;
      ctx.lineWidth = 1;
      for (let y = 0; y < gameMap.height; y++) {
        for (let x = 0; x < gameMap.width; x++) {
          if (gameMap.cells[y][x].solid) continue;
          const px = x * ts;
          const py = y * ts;
          ctx.strokeRect(px, py, ts, ts);
        }
      }
    }

    // --- Walls (only on non-solid cells, where a wall faces into open space) ---
    ctx.strokeStyle = this.wallColor;
    ctx.lineWidth = this.wallThickness * z;
    ctx.lineCap = 'round';

    for (let y = 0; y < gameMap.height; y++) {
      for (let x = 0; x < gameMap.width; x++) {
        const cell = gameMap.cells[y][x];
        if (cell.solid) continue; // solid cells are already visually filled
        const px = x * ts;
        const py = y * ts;

        if (cell.hasWall(WALL_N)) {
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ts, py); ctx.stroke();
        }
        if (cell.hasWall(WALL_S)) {
          ctx.beginPath(); ctx.moveTo(px, py + ts); ctx.lineTo(px + ts, py + ts); ctx.stroke();
        }
        if (cell.hasWall(WALL_W)) {
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + ts); ctx.stroke();
        }
        if (cell.hasWall(WALL_E)) {
          ctx.beginPath(); ctx.moveTo(px + ts, py); ctx.lineTo(px + ts, py + ts); ctx.stroke();
        }
      }
    }

    // --- Objects ---
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${ts * 0.5}px serif`;
    for (let y = 0; y < gameMap.height; y++) {
      for (let x = 0; x < gameMap.width; x++) {
        const cell = gameMap.cells[y][x];
        for (const obj of cell.objects) {
          const ox = (x + obj.x) * ts;
          const oy = (y + obj.y) * ts;
          ctx.fillText(obj.sprite, ox, oy);
        }
      }
    }

    // --- Player tokens ---
    for (const player of players) {
      const px = player.x * ts;
      const py = player.y * ts;
      const r = ts * 0.3;

      // Token circle
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * z;
      ctx.stroke();

      // Direction indicator
      const dirX = px + Math.cos(player.angle) * r * 1.4;
      const dirY = py + Math.sin(player.angle) * r * 1.4;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(dirX, dirY);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * z;
      ctx.stroke();

      // Name label
      ctx.fillStyle = '#fff';
      ctx.font = `${10 * z}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(player.name, px, py - r - 6 * z);
    }

    // --- FOV cone for active player ---
    if (activePlayer) {
      const px = activePlayer.x * ts;
      const py = activePlayer.y * ts;
      const fovHalf = Math.PI / 4; // 45° half-angle
      const fovLen = ts * 6;

      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, fovLen, activePlayer.angle - fovHalf, activePlayer.angle + fovHalf);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 200, 0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 200, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Attach mouse-wheel zoom to this canvas.
   * Zooms toward/away from the cursor position so the point under the
   * mouse stays fixed on screen.
   */
  setupScrollZoom() {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // World point under the cursor before zoom
      const worldBefore = this.screenToWorld(mouseX, mouseY);

      // Apply zoom
      const direction = e.deltaY < 0 ? 1 : -1;
      const oldZoom = this.camera.zoom;
      this.camera.zoom = Math.min(
        this.zoomMax,
        Math.max(this.zoomMin, this.camera.zoom * (1 + direction * this.zoomSpeed))
      );

      // Adjust camera so the world point stays under the cursor
      const newTs = this.tileSize * this.camera.zoom;
      this.camera.x = worldBefore.x * newTs - mouseX;
      this.camera.y = worldBefore.y * newTs - mouseY;
    }, { passive: false });
  }

  /** Convert canvas pixel coords to grid cell coords. */
  screenToGrid(screenX, screenY) {
    const z = this.camera.zoom;
    const ts = this.tileSize * z;
    const worldX = (screenX + this.camera.x) / ts;
    const worldY = (screenY + this.camera.y) / ts;
    return { x: Math.floor(worldX), y: Math.floor(worldY) };
  }

  /** Convert canvas pixel coords to world coords. */
  screenToWorld(screenX, screenY) {
    const z = this.camera.zoom;
    const ts = this.tileSize * z;
    return {
      x: (screenX + this.camera.x) / ts,
      y: (screenY + this.camera.y) / ts,
    };
  }
}
