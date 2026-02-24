/**
 * 2D top-down map renderer.
 * Draws the grid, walls, player token, objects, and a fog-of-war overlay.
 */

import { WALL_N, WALL_S, WALL_E, WALL_W } from '../engine/GameMap.js';

/** Parse a hex colour string (#rrggbb) to { r, g, b }. */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

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

    // Role-based rendering (set externally)
    this.role = null;  // 'dm' | 'player'

    // HP label hit areas for click-to-edit (populated each draw)
    this.hpHitAreas = [];

    // Solid-block fill colour
    this.solidColor = '#111';

    // Background image (loaded from gameMap.backgroundImage data URL)
    this.bgImage = null;
    this._loadBgImage();
  }

  /** Load background image from the gameMap data URL (if present). */
  _loadBgImage() {
    if (this.gameMap.backgroundImage) {
      const img = new Image();
      img.onload = () => { this.bgImage = img; };
      img.src = this.gameMap.backgroundImage;
    }
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
   * @param {boolean} [actionMode=false] – if true, dim non-active-turn players
   * @param {number|null} [turnActiveCharId=null] – characterId of the active-turn player
   * @param {object[]} [movementDataList=[]] – array of movement data entries for range circles
   */
  draw(players, activePlayer, actionMode = false, turnActiveCharId = null, movementDataList = []) {
    const { ctx, gameMap, tileSize, camera } = this;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const z = camera.zoom;
    const ts = tileSize * z;

    ctx.clearRect(0, 0, w, h);
    this.hpHitAreas = [];
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // --- Background image (DM reference overlay) ---
    if (this.bgImage && this.gameMap.backgroundImage) {
      ctx.save();
      ctx.globalAlpha = this.gameMap.bgOpacity;
      const imgW = this.bgImage.width * this.gameMap.bgScale * (ts / this.tileSize);
      const imgH = this.bgImage.height * this.gameMap.bgScale * (ts / this.tileSize);
      const imgX = this.gameMap.bgOffsetX * ts;
      const imgY = this.gameMap.bgOffsetY * ts;
      ctx.drawImage(this.bgImage, imgX, imgY, imgW, imgH);
      ctx.restore();
    }

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
      const isActiveTurn = actionMode && turnActiveCharId != null && player.characterId === turnActiveCharId;
      const isDimmed = actionMode && turnActiveCharId != null && !isActiveTurn;

      // Dim non-active players in action mode
      if (isDimmed) ctx.globalAlpha = 0.4;

      // Pulsing gold glow ring for active-turn player
      if (isActiveTurn) {
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.004);
        ctx.save();
        ctx.shadowColor = '#c9a84c';
        ctx.shadowBlur = 12 * z * pulse;
        ctx.beginPath();
        ctx.arc(px, py, r + 4 * z, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(201, 168, 76, ${pulse})`;
        ctx.lineWidth = 3 * z;
        ctx.stroke();
        ctx.restore();
      }

      // Token circle — monsters with images get circular-clipped image, otherwise colored circle
      if (player.isMonster && player._monsterImageObj && player._monsterImageObj.complete) {
        // Draw circular-clipped monster image
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(player._monsterImageObj, px - r, py - r, r * 2, r * 2);
        ctx.restore();
        // Red border for monsters
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.strokeStyle = isActiveTurn ? '#c9a84c' : '#e74c3c';
        ctx.lineWidth = isActiveTurn ? 3 * z : 2.5 * z;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = (player.isMonster && this.role !== 'dm') ? '#e74c3c' : player.color;
        ctx.fill();
        ctx.strokeStyle = isActiveTurn ? '#c9a84c' : (player.isMonster ? '#e74c3c' : '#fff');
        ctx.lineWidth = isActiveTurn ? 3 * z : 2 * z;
        ctx.stroke();
      }

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

      // Monster HP label (DM only) — red background badge below token
      if (this.role === 'dm' && player.isMonster && player.hp !== undefined && player.hp !== null) {
        const hpText = `${player.hp}/${player.maxHp ?? '?'}`;
        const fontSize = Math.max(10 * z, 10);
        ctx.save();
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textWidth = ctx.measureText(hpText).width;
        const padX = 5 * z;
        const padY = 3 * z;
        const boxW = textWidth + padX * 2;
        const boxH = fontSize + padY * 2;
        const boxX = px - boxW / 2;
        const boxY = py + r + 5 * z;

        // Red square background
        ctx.fillStyle = '#b41e1e';
        ctx.fillRect(boxX, boxY, boxW, boxH);

        // White HP text
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(hpText, px, boxY + padY);
        ctx.restore();

        // Store hit area in world coords for click detection
        this.hpHitAreas.push({
          characterId: player.characterId,
          worldX: boxX,
          worldY: boxY,
          worldW: boxW,
          worldH: boxH,
        });
      }

      // Reset alpha
      if (isDimmed) ctx.globalAlpha = 1;
    }

    // --- Movement range circles (one per visible character) ---
    for (const movementData of movementDataList) {
      if (!movementData || movementData.totalCells <= 0) continue;

      const startPx = movementData.startX * ts;
      const startPy = movementData.startY * ts;
      const radiusPixels = movementData.totalCells * ts;
      const isOver = movementData.overBudget;

      // Use player's colour for the circle, red when over budget
      const overRgb = { r: 231, g: 76, b: 60 };
      const circleRgb = isOver ? overRgb : hexToRgb(movementData.playerColor || '#2ecc71');

      // Filled circle at turn start
      ctx.beginPath();
      ctx.arc(startPx, startPy, radiusPixels, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${circleRgb.r}, ${circleRgb.g}, ${circleRgb.b}, ${isOver ? 0.06 : 0.08})`;
      ctx.fill();

      // Dashed border — turns red when over budget
      ctx.strokeStyle = `rgba(${circleRgb.r}, ${circleRgb.g}, ${circleRgb.b}, ${isOver ? 0.5 : 0.4})`;
      ctx.lineWidth = 2 * z;
      ctx.setLineDash([6 * z, 4 * z]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Small marker at start position (so players can see where they began)
      ctx.beginPath();
      ctx.arc(startPx, startPy, 4 * z, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${circleRgb.r}, ${circleRgb.g}, ${circleRgb.b}, ${isOver ? 0.6 : 0.5})`;
      ctx.fill();

      // --- Breadcrumb path trail ---
      const crumbs = movementData.breadcrumbs;
      if (crumbs && crumbs.length > 1) {
        // Draw the path line
        ctx.beginPath();
        ctx.moveTo(crumbs[0].x * ts, crumbs[0].y * ts);
        for (let i = 1; i < crumbs.length; i++) {
          ctx.lineTo(crumbs[i].x * ts, crumbs[i].y * ts);
        }
        ctx.strokeStyle = `rgba(${circleRgb.r}, ${circleRgb.g}, ${circleRgb.b}, 0.6)`;
        ctx.lineWidth = 3 * z;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        ctx.stroke();

        // Draw small dots along the path at intervals
        for (let i = 0; i < crumbs.length; i++) {
          // Draw every 3rd dot plus the first and last
          if (i === 0 || i === crumbs.length - 1 || i % 3 === 0) {
            ctx.beginPath();
            ctx.arc(crumbs[i].x * ts, crumbs[i].y * ts, 2.5 * z, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${circleRgb.r}, ${circleRgb.g}, ${circleRgb.b}, 0.8)`;
            ctx.fill();
          }
        }
      }

      // --- Distance label near start marker ---
      if (movementData.movedFeet > 0) {
        ctx.font = `bold ${10 * z}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const label = `${movementData.movedFeet}ft / ${movementData.totalFeet}ft`;
        const labelX = startPx;
        const labelY = startPy - 8 * z;
        // Background pill
        const tw = ctx.measureText(label).width + 8 * z;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.roundRect(labelX - tw / 2, labelY - 12 * z, tw, 14 * z, 3 * z);
        ctx.fill();
        // Text
        ctx.fillStyle = `rgb(${circleRgb.r}, ${circleRgb.g}, ${circleRgb.b})`;
        ctx.fillText(label, labelX, labelY);
      }
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

  /**
   * Pan the camera by a pixel delta.
   * @param {number} dx – pixels to shift horizontally
   * @param {number} dy – pixels to shift vertically
   */
  panBy(dx, dy) {
    this.camera.x += dx;
    this.camera.y += dy;
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

  /**
   * Check if a screen click lands on a monster HP label.
   * @returns {{ characterId: number, screenX: number, screenY: number } | null}
   */
  getHPHitAtScreen(screenX, screenY) {
    // Convert screen to world (accounting for camera offset)
    const worldClickX = screenX + this.camera.x;
    const worldClickY = screenY + this.camera.y;

    for (const area of this.hpHitAreas) {
      if (worldClickX >= area.worldX && worldClickX <= area.worldX + area.worldW &&
          worldClickY >= area.worldY && worldClickY <= area.worldY + area.worldH) {
        return {
          characterId: area.characterId,
          screenX: area.worldX - this.camera.x + area.worldW / 2,
          screenY: area.worldY - this.camera.y,
        };
      }
    }
    return null;
  }
}
