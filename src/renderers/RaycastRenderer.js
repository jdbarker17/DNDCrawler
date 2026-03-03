/**
 * First-person raycasting renderer.
 * Casts rays from the player's position across the 2D grid and draws
 * vertical wall strips with distance-based shading, plus floor/ceiling.
 */

import { WALL_N, WALL_S, WALL_E, WALL_W } from '../engine/GameMap.js';
import { drawCreature } from './CreatureSprites.js';

/** Parse a hex colour string (#rrggbb) to { r, g, b }. */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export class RaycastRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../engine/GameMap.js').GameMap} gameMap
   */
  constructor(canvas, gameMap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gameMap = gameMap;

    // Role-based rendering (set externally)
    this.role = null;  // 'dm' | 'player'

    // Rendering settings
    this.fov = Math.PI / 3; // 60° field of view
    this.maxDepth = 20;     // max ray distance
    this.wallHeight = 1.0;  // world-unit height of walls
    this.renderWidth = 480; // internal render resolution width
    this.renderHeight = 320;

    // Visual settings
    this.fogColor = { r: 20, g: 18, b: 24 };
    this.fogDensity = 0.08;
    this.ambientLight = 0.25;

    // Floor texture (loaded from gameMap.backgroundImage for textured floor rendering)
    this._floorTexture = null;      // Uint8ClampedArray pixel data [r,g,b,a, ...]
    this._floorTextureW = 0;        // texture pixel width
    this._floorTextureH = 0;        // texture pixel height
    this._floorImageData = null;    // cached ImageData buffer (avoids per-frame allocation)
    this._floorImageDataW = 0;
    this._floorImageDataH = 0;
    this._floorOffscreen = null;    // offscreen canvas for DPR-safe floor blitting
    this._floorOffscreenCtx = null;
  }

  /**
   * Load the background image from gameMap into a raw pixel array for
   * floor texture sampling. Uses an offscreen canvas to decode the data URL.
   */
  _loadFloorTexture() {
    this._floorTexture = null;
    this._floorTextureW = 0;
    this._floorTextureH = 0;

    if (!this.gameMap || !this.gameMap.backgroundImage) return;

    const img = new Image();
    img.onload = () => {
      const offscreen = document.createElement('canvas');
      offscreen.width = img.width;
      offscreen.height = img.height;
      const octx = offscreen.getContext('2d');
      octx.drawImage(img, 0, 0);
      const imgData = octx.getImageData(0, 0, img.width, img.height);
      this._floorTexture = imgData.data; // Uint8ClampedArray [r,g,b,a, ...]
      this._floorTextureW = img.width;
      this._floorTextureH = img.height;
    };
    img.onerror = () => {
      this._floorTexture = null;
    };
    img.src = this.gameMap.backgroundImage;
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
   * @param {object[]} [movementDataList=[]] – array of movement data entries for range rings
   * @param {object|null} [primaryMovementData=null] – the active turn character's data (for HUD bar)
   */
  draw(player, allPlayers = [], movementDataList = [], primaryMovementData = null) {
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

    // Draw floor gradient (base layer — will be overwritten by textured floor if available)
    const floorGrad = ctx.createLinearGradient(0, h / 2, 0, h);
    floorGrad.addColorStop(0, '#1a1a15');
    floorGrad.addColorStop(1, '#2a2a1a');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, h / 2, w, h / 2);

    // --- Cast rays (populate depthBuffer and collect wall strip data) ---
    const numRays = Math.floor(w); // one ray per pixel column
    const halfFov = fov / 2;

    // Depth buffer for sprite occlusion and floor wall-clipping
    const depthBuffer = new Float64Array(numRays);

    // When floor texture is available, defer wall drawing until after putImageData
    const hasFloorTexture = !!this._floorTexture;
    const wallStrips = hasFloorTexture ? [] : null;

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

      // Wall colour from per-edge color, falling back to cell default, shaded by distance
      const cellLight = result.cell ? result.cell.light : 1;
      const ec = result.cell?.wallEdgeColors;
      const edgeColor = (ec && result.wallEdge) ? ec[result.wallEdge] : null;
      const wallColorBase = this.gameMap.wallColor || edgeColor || (result.cell ? result.cell.wallColor : '#6b6b6b');

      // Side shading: walls hit on Y-axis are slightly darker
      const sideFactor = result.side === 1 ? 0.7 : 1.0;

      // Distance-based fog
      const fogFactor = Math.min(1, perpDist * this.fogDensity);
      const lightFactor = Math.max(this.ambientLight, cellLight * sideFactor * (1 - fogFactor));

      const color = this._shadeColor(wallColorBase, lightFactor, fogFactor);

      if (hasFloorTexture) {
        // Defer wall drawing until after textured floor is blitted
        wallStrips.push({ x: i, y: drawStart, h: lineHeight, color });
      } else {
        // No texture: draw wall strips immediately on top of gradient
        ctx.fillStyle = color;
        ctx.fillRect(i, drawStart, 1, lineHeight);
      }
    }

    // --- Textured floor: blit image-sampled floor, then draw deferred wall strips on top ---
    if (hasFloorTexture) {
      this._drawTexturedFloor(w, h, player.x, player.y, player.angle, depthBuffer);
      for (const strip of wallStrips) {
        ctx.fillStyle = strip.color;
        ctx.fillRect(strip.x, strip.y, 1, strip.h);
      }
    }

    // --- Draw sprite objects and other players in view ---
    this._drawSprites(player, allPlayers, w, h, halfFov, depthBuffer);

    // --- Movement range rings on the floor (one per visible character) ---
    for (const movementData of movementDataList) {
      if (!movementData || movementData.totalCells <= 0) continue;
      const startX = movementData.startX ?? player.x;
      const startY = movementData.startY ?? player.y;
      const isOver = movementData.overBudget || false;
      const playerColor = movementData.playerColor || '#2ecc71';
      this._drawMovementRing(player, w, h, halfFov, movementData.totalCells, depthBuffer, startX, startY, isOver, playerColor);

      // Draw breadcrumb path projected onto the floor
      const crumbs = movementData.breadcrumbs;
      if (crumbs && crumbs.length > 1) {
        this._drawBreadcrumbPath(player, w, h, halfFov, depthBuffer, crumbs, isOver, playerColor);
      }
    }

    // --- Overlay: subtle vignette ---
    this._drawVignette(ctx, w, h);

    // --- HUD compass ---
    this._drawCompass(ctx, w, h, player.angle);

    // --- HUD movement bar (only for the primary/active turn character) ---
    if (primaryMovementData) {
      this._drawMovementHUD(ctx, w, h, primaryMovementData.movedFeet ?? 0, primaryMovementData.totalFeet, primaryMovementData.overBudget, primaryMovementData.playerColor);
    }
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
            const hitCell = cell || prevCell;
            const wallEdge = cell ? 'W' : 'E';
            return { distance, side, cell: hitCell, wallEdge };
          }
        } else {
          // Moved west
          if (prevCell?.hasWall(WALL_W) || cell?.hasWall(WALL_E)) {
            const hitCell = cell || prevCell;
            const wallEdge = cell ? 'E' : 'W';
            return { distance, side, cell: hitCell, wallEdge };
          }
        }

        // Out of bounds = wall
        if (!this.gameMap.inBounds(mapX, mapY)) {
          return { distance, side, cell: null, wallEdge: null };
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
            const hitCell = cell || prevCell;
            const wallEdge = cell ? 'N' : 'S';
            return { distance, side, cell: hitCell, wallEdge };
          }
        } else {
          if (prevCell?.hasWall(WALL_N) || cell?.hasWall(WALL_S)) {
            const hitCell = cell || prevCell;
            const wallEdge = cell ? 'S' : 'N';
            return { distance, side, cell: hitCell, wallEdge };
          }
        }

        if (!this.gameMap.inBounds(mapX, mapY)) {
          return { distance, side, cell: null, wallEdge: null };
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
        const baseH = (this.wallHeight * 0.8 / perpDist) * projDist;
        const spriteH = baseH * (sp.player.spriteScale ?? 1);
        const spriteW = spriteH * 0.6;
        const screenY = screenH / 2;

        ctx.globalAlpha = 1 - fogFactor;

        // Monster with custom image: draw scaled image sprite
        if (sp.player.isMonster && sp.player._monsterImageObj && sp.player._monsterImageObj.complete) {
          const imgW = spriteH * 0.8;
          const imgH = spriteH * 1.2;
          const imgX = screenX - imgW / 2;
          const floorY = screenY + baseH * 0.3; // ground plane where feet meet floor
          const imgY = floorY - imgH;            // bottom anchored to floor
          ctx.drawImage(sp.player._monsterImageObj, imgX, imgY, imgW, imgH);

          // Name label above monster image
          const nameSize = Math.max(8, Math.min(16, spriteH * 0.12));
          ctx.font = `bold ${nameSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';

          const nameWidth = ctx.measureText(sp.player.name).width + 8;
          const nameY = imgY - 4;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(screenX - nameWidth / 2, nameY - nameSize, nameWidth, nameSize + 4);
          ctx.fillStyle = '#e74c3c';
          ctx.fillText(sp.player.name, screenX, nameY + 2);
        } else {
          const monsterColor = (sp.player.isMonster && this.role !== 'dm') ? '#e74c3c' : sp.player.color;

          // Monster with creature type: use procedural creature sprite
          if (sp.player.isMonster && sp.player.creatureType) {
            drawCreature(ctx, sp.player.creatureType, screenX, screenY, spriteW, spriteH, monsterColor);
          } else {
            // Regular player: humanoid silhouette with token emoji
            drawCreature(ctx, 'humanoid', screenX, screenY, spriteW, spriteH, monsterColor);

            // Token emoji on body
            const emojiSize = Math.max(10, spriteH * 0.3);
            ctx.font = `${emojiSize}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(sp.label, screenX, screenY - spriteH * 0.3 + spriteH * 0.6 * 0.4);
          }

          // Name label above sprite
          const nameSize = Math.max(8, Math.min(16, spriteH * 0.12));
          ctx.font = `bold ${nameSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';

          const nameWidth = ctx.measureText(sp.player.name).width + 8;
          const nameY = screenY - spriteH * 0.5 - 4;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(screenX - nameWidth / 2, nameY - nameSize, nameWidth, nameSize + 4);

          ctx.fillStyle = sp.player.isMonster ? '#e74c3c' : sp.player.color;
          ctx.fillText(sp.player.name, screenX, nameY + 2);
        }

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

  /**
   * Draw a projected ring on the ground showing movement range.
   * The ring is centred at (centreX, centreY) — the turn start position —
   * not at the viewer's current position.
   */
  _drawMovementRing(viewer, screenW, screenH, halfFov, radiusCells, depthBuffer, centreX, centreY, isOver = false, playerColor = '#2ecc71') {
    const { ctx } = this;
    const projDist = screenH / (2 * Math.tan(halfFov));
    const segments = 64;
    const points = [];

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      // Circle points are around the turn start position, not the viewer
      const wx = centreX + Math.cos(angle) * radiusCells;
      const wy = centreY + Math.sin(angle) * radiusCells;

      // Vector from viewer to this ring point
      const dx = wx - viewer.x;
      const dy = wy - viewer.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let relAngle = Math.atan2(dy, dx) - viewer.angle;
      while (relAngle > Math.PI) relAngle -= 2 * Math.PI;
      while (relAngle < -Math.PI) relAngle += 2 * Math.PI;

      const perpDist = dist * Math.cos(relAngle);
      if (perpDist <= 0.1) continue;

      const screenX = (0.5 + relAngle / (halfFov * 2)) * screenW;
      // Floor at ground level (camera height = 0.5 * wallHeight)
      const screenY = screenH / 2 + (0.5 * this.wallHeight / perpDist) * projDist;

      // Depth test against wall buffer
      const col = Math.floor(screenX);
      const visible = col >= 0 && col < depthBuffer.length && perpDist < depthBuffer[col];

      points.push({ screenX, screenY, visible, perpDist });
    }

    // Draw connected segments
    const overRgb = { r: 231, g: 76, b: 60 };
    const ringRgb = isOver ? overRgb : hexToRgb(playerColor);
    ctx.save();
    ctx.strokeStyle = `rgba(${ringRgb.r}, ${ringRgb.g}, ${ringRgb.b}, 0.5)`;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);

    ctx.beginPath();
    let penDown = false;
    for (const pt of points) {
      if (pt.visible && pt.screenX >= -50 && pt.screenX <= screenW + 50) {
        if (!penDown) {
          ctx.moveTo(pt.screenX, pt.screenY);
          penDown = true;
        } else {
          ctx.lineTo(pt.screenX, pt.screenY);
        }
      } else {
        penDown = false;
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * Draw breadcrumb path projected onto the ground plane.
   */
  _drawBreadcrumbPath(viewer, screenW, screenH, halfFov, depthBuffer, crumbs, isOver, playerColor = '#2ecc71') {
    const { ctx } = this;
    const projDist = screenH / (2 * Math.tan(halfFov));
    const projected = [];

    for (const pt of crumbs) {
      const dx = pt.x - viewer.x;
      const dy = pt.y - viewer.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.05) continue; // too close to viewer

      let relAngle = Math.atan2(dy, dx) - viewer.angle;
      while (relAngle > Math.PI) relAngle -= 2 * Math.PI;
      while (relAngle < -Math.PI) relAngle += 2 * Math.PI;

      const perpDist = dist * Math.cos(relAngle);
      if (perpDist <= 0.1) continue;

      const screenX = (0.5 + relAngle / (halfFov * 2)) * screenW;
      const screenY = screenH / 2 + (0.5 * this.wallHeight / perpDist) * projDist;

      // Depth test
      const col = Math.floor(screenX);
      const visible = col >= 0 && col < depthBuffer.length && perpDist < depthBuffer[col];

      projected.push({ screenX, screenY, visible, perpDist });
    }

    if (projected.length < 2) return;

    // Draw path line
    const overRgbP = { r: 231, g: 76, b: 60 };
    const pathRgb = isOver ? overRgbP : hexToRgb(playerColor);
    ctx.save();
    ctx.strokeStyle = `rgba(${pathRgb.r}, ${pathRgb.g}, ${pathRgb.b}, 0.6)`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    let penDown = false;
    for (const pt of projected) {
      if (pt.visible && pt.screenX >= -50 && pt.screenX <= screenW + 50) {
        if (!penDown) {
          ctx.moveTo(pt.screenX, pt.screenY);
          penDown = true;
        } else {
          ctx.lineTo(pt.screenX, pt.screenY);
        }
      } else {
        penDown = false;
      }
    }
    ctx.stroke();

    // Draw dots at intervals
    for (let i = 0; i < projected.length; i++) {
      if ((i === 0 || i === projected.length - 1 || i % 3 === 0) && projected[i].visible) {
        const pt = projected[i];
        const dotSize = Math.max(1.5, 3 / pt.perpDist);
        ctx.beginPath();
        ctx.arc(pt.screenX, pt.screenY, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${pathRgb.r}, ${pathRgb.g}, ${pathRgb.b}, 0.8)`;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Draw a HUD movement bar at the bottom of the screen.
   * Shows distance moved vs total budget. Turns red when over budget.
   */
  _drawMovementHUD(ctx, w, h, movedFeet, totalFeet, overBudget = false, playerColor = '#2ecc71') {
    if (totalFeet <= 0) return;

    const barW = 120;
    const barH = 8;
    const x = w / 2 - barW / 2;
    const y = h - 30;
    // Fill shows how much has been used (not remaining)
    const pct = Math.min(1, movedFeet / totalFeet);

    ctx.save();
    ctx.globalAlpha = 0.7;

    // Background bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 4);
    ctx.fill();

    // Fill bar — player colour when within budget, orange when getting low, red when over
    const fillColor = overBudget ? '#e74c3c' : (pct > 0.7 ? '#e67e22' : playerColor);
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.roundRect(x, y, barW * pct, barH, 4);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 4);
    ctx.stroke();

    // Text label
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = overBudget ? '#e74c3c' : playerColor;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${movedFeet}ft / ${totalFeet}ft`, w / 2, y - 4);

    ctx.restore();
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

  /**
   * Render textured floor into the lower half of the screen using scanline
   * floor casting. For each row below the horizon, compute world-space floor
   * coordinates via linear interpolation, sample the background image, and
   * write to an ImageData buffer with distance fog.
   *
   * @param {number} w – screen width
   * @param {number} h – screen height
   * @param {number} playerX – viewer world X
   * @param {number} playerY – viewer world Y
   * @param {number} playerAngle – viewer facing angle (radians)
   * @param {Float64Array} depthBuffer – wall perpendicular distance per column
   */
  _drawTexturedFloor(w, h, playerX, playerY, playerAngle, depthBuffer) {
    const { ctx, fov, fogColor, fogDensity, ambientLight } = this;
    const halfFov = fov / 2;

    // Projection distance (pixels from eye to projection plane)
    const projDist = h / (2 * Math.tan(halfFov));

    // Camera height (world units) — eye level is at half wall height
    const camHeight = this.wallHeight * 0.5;

    // Camera direction and perpendicular plane vectors
    const dirX = Math.cos(playerAngle);
    const dirY = Math.sin(playerAngle);
    const planeX = Math.cos(playerAngle + Math.PI / 2) * Math.tan(halfFov);
    const planeY = Math.sin(playerAngle + Math.PI / 2) * Math.tan(halfFov);

    // Floor region: bottom half of the screen
    const floorStartY = Math.floor(h / 2);
    const floorH = Math.ceil(h - floorStartY);
    const floorW = Math.floor(w);

    // Reuse or create offscreen canvas + ImageData buffer
    // (putImageData ignores canvas transforms, so we write to an offscreen canvas
    //  at CSS-pixel resolution, then drawImage onto the main canvas which DOES
    //  respect the DPR transform set in resize())
    if (!this._floorOffscreen || this._floorImageDataW !== floorW || this._floorImageDataH !== floorH) {
      this._floorOffscreen = document.createElement('canvas');
      this._floorOffscreen.width = floorW;
      this._floorOffscreen.height = floorH;
      this._floorOffscreenCtx = this._floorOffscreen.getContext('2d');
      this._floorImageData = this._floorOffscreenCtx.createImageData(floorW, floorH);
      this._floorImageDataW = floorW;
      this._floorImageDataH = floorH;
    }
    const pixels = this._floorImageData.data;
    pixels.fill(0); // clear to transparent black

    // Texture sampling constants
    const tileSize = 40; // must match MapRenderer2D.tileSize
    const bgOffsetX = this.gameMap.bgOffsetX;
    const bgOffsetY = this.gameMap.bgOffsetY;
    const bgScale = this.gameMap.bgScale;
    const texW = this._floorTextureW;
    const texH = this._floorTextureH;
    const texData = this._floorTexture;
    const texScaleFactor = tileSize / bgScale;

    const fogR = fogColor.r;
    const fogG = fogColor.g;
    const fogB = fogColor.b;

    // Pixel skip for performance on wide screens
    const pixelSkip = floorW > 640 ? 2 : 1;

    for (let row = 0; row < floorH; row++) {
      // Distance from camera to this floor row
      const rowDist = (camHeight * projDist) / (row + 0.5);

      // World-space step per pixel column along this scanline
      const floorStepX = (rowDist * 2 * planeX) / floorW;
      const floorStepY = (rowDist * 2 * planeY) / floorW;

      // World position at the leftmost pixel of this row
      let worldX = playerX + rowDist * (dirX - planeX);
      let worldY = playerY + rowDist * (dirY - planeY);

      // Distance-based fog for this row (uniform across the row)
      const fog = Math.min(1, rowDist * fogDensity);
      const lightFactor = Math.max(ambientLight, 1 - fog);
      const invFog = 1 - fog;

      const rowOffset = row * floorW * 4;

      for (let x = 0; x < floorW; x += pixelSkip) {
        // Wall occlusion: if wall is closer than this floor row, skip
        if (x < depthBuffer.length && rowDist >= depthBuffer[x]) {
          worldX += floorStepX * pixelSkip;
          worldY += floorStepY * pixelSkip;
          continue;
        }

        // Map world coords to texture pixel
        const texX = ((worldX - bgOffsetX) * texScaleFactor) | 0;
        const texY = ((worldY - bgOffsetY) * texScaleFactor) | 0;

        let r, g, b;
        if (texX >= 0 && texX < texW && texY >= 0 && texY < texH) {
          const texIdx = (texY * texW + texX) * 4;
          r = texData[texIdx];
          g = texData[texIdx + 1];
          b = texData[texIdx + 2];
        } else {
          // Outside texture bounds: dark fallback matching gradient tone
          r = 42; g = 42; b = 26;
        }

        // Apply fog blending
        const pr = (r * lightFactor * invFog + fogR * fog) | 0;
        const pg = (g * lightFactor * invFog + fogG * fog) | 0;
        const pb = (b * lightFactor * invFog + fogB * fog) | 0;

        const pixelIdx = rowOffset + x * 4;
        pixels[pixelIdx]     = pr > 255 ? 255 : pr;
        pixels[pixelIdx + 1] = pg > 255 ? 255 : pg;
        pixels[pixelIdx + 2] = pb > 255 ? 255 : pb;
        pixels[pixelIdx + 3] = 255;

        // Duplicate pixel when skipping for performance
        if (pixelSkip > 1 && x + 1 < floorW) {
          const nextIdx = rowOffset + (x + 1) * 4;
          pixels[nextIdx]     = pixels[pixelIdx];
          pixels[nextIdx + 1] = pixels[pixelIdx + 1];
          pixels[nextIdx + 2] = pixels[pixelIdx + 2];
          pixels[nextIdx + 3] = 255;
        }

        worldX += floorStepX * pixelSkip;
        worldY += floorStepY * pixelSkip;
      }
    }

    // Blit the textured floor to the canvas via offscreen canvas
    // (drawImage respects the DPR transform; putImageData does not)
    this._floorOffscreenCtx.putImageData(this._floorImageData, 0, 0);
    ctx.drawImage(this._floorOffscreen, 0, floorStartY);
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
