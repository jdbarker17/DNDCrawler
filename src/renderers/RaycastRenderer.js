/**
 * First-person raycasting renderer.
 * Casts rays from the player's position across the 2D grid and draws
 * vertical wall strips with distance-based shading, plus floor/ceiling.
 */

import { WALL_N, WALL_S, WALL_E, WALL_W } from '../engine/GameMap.js';

export class RaycastRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../engine/GameMap.js').GameMap} gameMap
   */
  constructor(canvas, gameMap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gameMap = gameMap;

    // Rendering settings
    this.fov = Math.PI / 3; // 60° field of view
    this.maxDepth = 20;     // max ray distance
    this.wallHeight = 1.0;  // world-unit height of walls
    this.renderWidth = 480; // internal render resolution width
    this.renderHeight = 320;

    // Visual settings
    this.fogColor = { r: 10, g: 10, b: 15 };
    this.fogDensity = 0.12;
    this.ambientLight = 0.15;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Scale internal resolution to match aspect ratio
    this.renderWidth = Math.floor(rect.width);
    this.renderHeight = Math.floor(rect.height);
  }

  /**
   * Main draw call.
   * @param {import('../engine/Player.js').Player} player – the viewer
   * @param {import('../engine/Player.js').Player[]} allPlayers – all players on the map
   */
  draw(player, allPlayers = []) {
    const { ctx, gameMap, renderWidth, renderHeight, fov, maxDepth } = this;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Clear with dark background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    // Draw ceiling gradient
    const ceilGrad = ctx.createLinearGradient(0, 0, 0, h / 2);
    ceilGrad.addColorStop(0, '#0a0a0f');
    ceilGrad.addColorStop(1, '#1a1a25');
    ctx.fillStyle = ceilGrad;
    ctx.fillRect(0, 0, w, h / 2);

    // Draw floor gradient
    const floorGrad = ctx.createLinearGradient(0, h / 2, 0, h);
    floorGrad.addColorStop(0, '#1a1a15');
    floorGrad.addColorStop(1, '#2a2a1a');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, h / 2, w, h / 2);

    // --- Cast rays ---
    const numRays = Math.floor(w); // one ray per pixel column
    const halfFov = fov / 2;

    // Depth buffer for sprite occlusion against walls
    const depthBuffer = new Float64Array(numRays);

    for (let i = 0; i < numRays; i++) {
      // Ray angle: sweep from -halfFov to +halfFov relative to player
      const rayAngle = player.angle - halfFov + (i / numRays) * fov;
      const result = this._castRay(player.x, player.y, rayAngle);

      if (!result) {
        depthBuffer[i] = maxDepth;
        continue;
      }

      // Fix fisheye by using perpendicular distance
      const perpDist = result.distance * Math.cos(rayAngle - player.angle);

      if (perpDist <= 0) {
        depthBuffer[i] = maxDepth;
        continue;
      }

      depthBuffer[i] = perpDist;

      // Wall strip height (projection)
      const lineHeight = (this.wallHeight / perpDist) * (h / (2 * Math.tan(halfFov)));
      const drawStart = (h - lineHeight) / 2;

      // Wall colour from the cell, shaded by distance and cell light
      const cellLight = result.cell ? result.cell.light : 1;
      const wallColorBase = result.cell ? result.cell.wallColor : '#6b6b6b';

      // Side shading: walls hit on Y-axis are slightly darker
      const sideFactor = result.side === 1 ? 0.7 : 1.0;

      // Distance-based fog
      const fogFactor = Math.min(1, perpDist * this.fogDensity);
      const lightFactor = Math.max(this.ambientLight, cellLight * sideFactor * (1 - fogFactor));

      const color = this._shadeColor(wallColorBase, lightFactor, fogFactor);
      ctx.fillStyle = color;
      ctx.fillRect(i, drawStart, 1, lineHeight);
    }

    // --- Draw sprite objects and other players in view ---
    this._drawSprites(player, allPlayers, w, h, halfFov, depthBuffer);

    // --- Overlay: subtle vignette ---
    this._drawVignette(ctx, w, h);

    // --- HUD compass ---
    this._drawCompass(ctx, w, h, player.angle);
  }

  /**
   * DDA raycasting algorithm – walks through the grid checking wall intersections.
   */
  _castRay(px, py, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let mapX = Math.floor(px);
    let mapY = Math.floor(py);

    const stepX = dx >= 0 ? 1 : -1;
    const stepY = dy >= 0 ? 1 : -1;

    // Distance to next grid line
    let tMaxX = dx !== 0 ? ((dx >= 0 ? mapX + 1 : mapX) - px) / dx : Infinity;
    let tMaxY = dy !== 0 ? ((dy >= 0 ? mapY + 1 : mapY) - py) / dy : Infinity;

    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;

    let side = 0; // 0 = hit vertical wall face, 1 = hit horizontal wall face
    let distance = 0;

    for (let i = 0; i < 100; i++) {
      // Step to next grid boundary
      if (tMaxX < tMaxY) {
        distance = tMaxX;
        mapX += stepX;
        tMaxX += tDeltaX;
        side = 0;

        // Check wall on the face we just crossed
        const cell = this.gameMap.getCell(mapX, mapY);
        const prevCell = this.gameMap.getCell(mapX - stepX, mapY);

        if (stepX > 0) {
          // Moved east: check previous cell's east wall or current cell's west wall
          if (prevCell?.hasWall(WALL_E) || cell?.hasWall(WALL_W)) {
            return { distance, side, cell: cell || prevCell };
          }
        } else {
          // Moved west
          if (prevCell?.hasWall(WALL_W) || cell?.hasWall(WALL_E)) {
            return { distance, side, cell: cell || prevCell };
          }
        }

        // Out of bounds = wall
        if (!this.gameMap.inBounds(mapX, mapY)) {
          return { distance, side, cell: null };
        }
      } else {
        distance = tMaxY;
        mapY += stepY;
        tMaxY += tDeltaY;
        side = 1;

        const cell = this.gameMap.getCell(mapX, mapY);
        const prevCell = this.gameMap.getCell(mapX, mapY - stepY);

        if (stepY > 0) {
          if (prevCell?.hasWall(WALL_S) || cell?.hasWall(WALL_N)) {
            return { distance, side, cell: cell || prevCell };
          }
        } else {
          if (prevCell?.hasWall(WALL_N) || cell?.hasWall(WALL_S)) {
            return { distance, side, cell: cell || prevCell };
          }
        }

        if (!this.gameMap.inBounds(mapX, mapY)) {
          return { distance, side, cell: null };
        }
      }

      if (distance > this.maxDepth) return null;
    }

    return null;
  }

  /**
   * Draw sprite objects and other player characters in the viewer's FOV.
   * Uses the depth buffer to occlude sprites behind walls.
   */
  _drawSprites(viewer, allPlayers, screenW, screenH, halfFov, depthBuffer) {
    const { ctx, gameMap } = this;
    const sprites = [];

    // Collect map object sprites
    for (let y = 0; y < gameMap.height; y++) {
      for (let x = 0; x < gameMap.width; x++) {
        const cell = gameMap.cells[y][x];
        for (const obj of cell.objects) {
          const wx = x + obj.x;
          const wy = y + obj.y;
          const dx = wx - viewer.x;
          const dy = wy - viewer.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > this.maxDepth || dist < 0.3) continue;

          const angle = Math.atan2(dy, dx);
          let relAngle = angle - viewer.angle;
          while (relAngle > Math.PI) relAngle -= 2 * Math.PI;
          while (relAngle < -Math.PI) relAngle += 2 * Math.PI;

          if (Math.abs(relAngle) < halfFov + 0.1) {
            sprites.push({ type: 'object', label: obj.sprite, dist, relAngle });
          }
        }
      }
    }

    // Collect other player sprites
    for (const p of allPlayers) {
      if (p.id === viewer.id) continue; // don't draw self

      const dx = p.x - viewer.x;
      const dy = p.y - viewer.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > this.maxDepth || dist < 0.3) continue;

      const angle = Math.atan2(dy, dx);
      let relAngle = angle - viewer.angle;
      while (relAngle > Math.PI) relAngle -= 2 * Math.PI;
      while (relAngle < -Math.PI) relAngle += 2 * Math.PI;

      if (Math.abs(relAngle) < halfFov + 0.1) {
        sprites.push({ type: 'player', player: p, label: p.token || '\u{1F9D1}', dist, relAngle });
      }
    }

    // Sort far to near (painter's order)
    sprites.sort((a, b) => b.dist - a.dist);

    const projDist = screenH / (2 * Math.tan(halfFov));

    for (const sp of sprites) {
      const screenX = (0.5 + sp.relAngle / (halfFov * 2)) * screenW;
      const perpDist = sp.dist * Math.cos(sp.relAngle);

      // Depth test: check if this sprite column is behind a wall
      const col = Math.floor(screenX);
      if (col >= 0 && col < depthBuffer.length && perpDist > depthBuffer[col]) {
        continue; // occluded by wall
      }

      const fogFactor = Math.min(0.9, sp.dist * this.fogDensity);

      if (sp.type === 'player') {
        // Draw player as a coloured figure with token emoji and name
        const spriteH = (this.wallHeight * 0.8 / perpDist) * projDist;
        const spriteW = spriteH * 0.6;
        const screenY = screenH / 2;

        ctx.globalAlpha = 1 - fogFactor;

        // Body silhouette (rounded rectangle)
        const bodyX = screenX - spriteW / 2;
        const bodyY = screenY - spriteH * 0.3;
        const bodyH = spriteH * 0.6;

        ctx.fillStyle = sp.player.color;
        ctx.beginPath();
        const r = spriteW * 0.3;
        ctx.moveTo(bodyX + r, bodyY);
        ctx.lineTo(bodyX + spriteW - r, bodyY);
        ctx.quadraticCurveTo(bodyX + spriteW, bodyY, bodyX + spriteW, bodyY + r);
        ctx.lineTo(bodyX + spriteW, bodyY + bodyH - r);
        ctx.quadraticCurveTo(bodyX + spriteW, bodyY + bodyH, bodyX + spriteW - r, bodyY + bodyH);
        ctx.lineTo(bodyX + r, bodyY + bodyH);
        ctx.quadraticCurveTo(bodyX, bodyY + bodyH, bodyX, bodyY + bodyH - r);
        ctx.lineTo(bodyX, bodyY + r);
        ctx.quadraticCurveTo(bodyX, bodyY, bodyX + r, bodyY);
        ctx.closePath();
        ctx.fill();

        // Head circle
        const headR = spriteW * 0.35;
        ctx.beginPath();
        ctx.arc(screenX, bodyY - headR * 0.5, headR, 0, Math.PI * 2);
        ctx.fillStyle = sp.player.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = Math.max(1, spriteW * 0.05);
        ctx.stroke();

        // Token emoji on body
        const emojiSize = Math.max(10, spriteH * 0.3);
        ctx.font = `${emojiSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sp.label, screenX, bodyY + bodyH * 0.4);

        // Name label above head
        const nameSize = Math.max(8, Math.min(16, spriteH * 0.12));
        ctx.font = `bold ${nameSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        // Name background
        const nameWidth = ctx.measureText(sp.player.name).width + 8;
        const nameY = bodyY - headR * 0.5 - headR - 4;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(screenX - nameWidth / 2, nameY - nameSize, nameWidth, nameSize + 4);

        // Name text
        ctx.fillStyle = sp.player.color;
        ctx.fillText(sp.player.name, screenX, nameY + 2);

        ctx.globalAlpha = 1;
      } else {
        // Map object sprite (emoji)
        const size = Math.min(200, (1 / sp.dist) * screenH * 0.4);
        const screenY = screenH / 2 + size * 0.1;

        ctx.globalAlpha = 1 - fogFactor;
        ctx.font = `${size}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sp.label, screenX, screenY);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Shade a hex colour by a light factor, blending toward fog colour. */
  _shadeColor(hex, lightFactor, fogFactor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const lr = Math.floor(r * lightFactor * (1 - fogFactor) + this.fogColor.r * fogFactor);
    const lg = Math.floor(g * lightFactor * (1 - fogFactor) + this.fogColor.g * fogFactor);
    const lb = Math.floor(b * lightFactor * (1 - fogFactor) + this.fogColor.b * fogFactor);

    return `rgb(${Math.min(255, lr)},${Math.min(255, lg)},${Math.min(255, lb)})`;
  }

  /** Subtle edge darkening for atmosphere. */
  _drawVignette(ctx, w, h) {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.9);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  /** Small compass in the top-right corner. */
  _drawCompass(ctx, w, h, angle) {
    const cx = w - 40;
    const cy = 40;
    const r = 20;

    ctx.save();
    ctx.globalAlpha = 0.6;

    // Background
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.stroke();

    // N indicator (north = angle 0 in our system points right, but compass N = "up" = -π/2)
    const northAngle = -Math.PI / 2 - angle;
    const nx = cx + Math.cos(northAngle) * r * 0.7;
    const ny = cy + Math.sin(northAngle) * r * 0.7;
    ctx.fillStyle = '#e74c3c';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);

    // Player dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    ctx.restore();
  }
}
