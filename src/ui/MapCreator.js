/**
 * Full-screen map editor for DMs.
 * Allows uploading a background image, painting walls/solidity/floors/objects,
 * resizing the grid, and saving the result as a GameMap.
 */

import { GameMap, Cell, WALL_N, WALL_S, WALL_E, WALL_W } from '../engine/GameMap.js';

const OBJECT_PALETTE = [
  { type: 'torch', sprite: '🔥', label: 'Torch' },
  { type: 'chest', sprite: '📦', label: 'Chest' },
  { type: 'door', sprite: '🚪', label: 'Door' },
  { type: 'skeleton', sprite: '💀', label: 'Skeleton' },
  { type: 'altar', sprite: '🗿', label: 'Altar' },
  { type: 'treasure', sprite: '💎', label: 'Gem' },
  { type: 'potion', sprite: '🧪', label: 'Potion' },
  { type: 'key', sprite: '🔑', label: 'Key' },
  { type: 'trap', sprite: '⚠️', label: 'Trap' },
  { type: 'barrel', sprite: '🛢️', label: 'Barrel' },
];

const FLOOR_COLORS = [
  '#3a3a2a', '#4a4a3a', '#4a3a2a', '#2a2a2a',
  '#5a4a1a', '#3a1a3a', '#2a3a3a', '#3a3a3a',
];

const LIGHT_LEVELS = [0.2, 0.4, 0.6, 0.8, 1.0];

export class MapCreator {
  /**
   * @param {HTMLElement} container
   * @param {GameMap|null} existingMap – null for blank, or existing map to edit
   * @param {(mapData: object) => void} onSave
   * @param {() => void} onCancel
   */
  constructor(container, existingMap, onSave, onCancel) {
    this.container = container;
    this.onSave = onSave;
    this.onCancel = onCancel;

    this.gameMap = existingMap || this._createBlankMap(20, 20);
    this.canvas = null;
    this.ctx = null;
    this.bgImage = null; // HTMLImageElement

    this.activeTool = 'wall';
    this.selectedObject = OBJECT_PALETTE[0];
    this.tileSize = 40;

    // Camera
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.zoomMin = 0.2;
    this.zoomMax = 5;

    // Interaction state
    this.isPanning = false;
    this.panLastX = 0;
    this.panLastY = 0;
    this.isDraggingImage = false;
    this.imgDragLastX = 0;
    this.imgDragLastY = 0;

    // Hover state for cursor highlight
    this.hoverGridX = -1;
    this.hoverGridY = -1;
    this.hoverEdge = null; // 'N' | 'S' | 'E' | 'W' | null

    this._boundHandlers = {};
    this._buildUI();
    this._loadBackgroundImage();
    this._render();
  }

  _createBlankMap(w, h) {
    const map = new GameMap(w, h);
    // Start with all cells passable (empty room)
    return map;
  }

  // --- UI Construction ---

  _buildUI() {
    this.panel = document.createElement('div');
    this.panel.id = 'map-creator';
    this.panel.innerHTML = `
      <div class="mc-header">
        <h1>Map Creator</h1>
        <div class="mc-header-actions">
          <button class="mc-btn" id="mc-cancel">Cancel</button>
          <button class="mc-btn primary" id="mc-save">Save Map</button>
        </div>
      </div>
      <div class="mc-body">
        <div class="mc-sidebar">
          <!-- Map Settings -->
          <div class="mc-panel">
            <div class="mc-panel-title">Map Settings</div>
            <div class="mc-row">
              <label>Width <input type="number" id="mc-width" min="5" max="100" value="${this.gameMap.width}"></label>
              <label>Height <input type="number" id="mc-height" min="5" max="100" value="${this.gameMap.height}"></label>
            </div>
            <button class="mc-btn small" id="mc-resize">Resize Grid</button>
          </div>
          <!-- Background Image -->
          <div class="mc-panel">
            <div class="mc-panel-title">Background Image</div>
            <button class="mc-btn small" id="mc-upload-btn">Upload Image</button>
            <input type="file" id="mc-file-input" accept="image/*" style="display:none">
            <button class="mc-btn small mc-danger" id="mc-clear-img" style="display:none">Remove Image</button>
            <label>Opacity <input type="range" id="mc-bg-opacity" min="0" max="100" value="${Math.round(this.gameMap.bgOpacity * 100)}"></label>
            <label>Scale <input type="range" id="mc-bg-scale" min="10" max="300" value="${Math.round(this.gameMap.bgScale * 100)}"></label>
            <div class="mc-hint">Shift+drag to reposition image</div>
          </div>
          <!-- Tools -->
          <div class="mc-panel">
            <div class="mc-panel-title">Tools</div>
            <div class="mc-tools-grid">
              <button class="mc-tool-btn active" data-tool="wall">Wall</button>
              <button class="mc-tool-btn" data-tool="solid">Solid</button>
              <button class="mc-tool-btn" data-tool="floor">Floor</button>
              <button class="mc-tool-btn" data-tool="light">Light</button>
              <button class="mc-tool-btn" data-tool="object">Object</button>
              <button class="mc-tool-btn" data-tool="erase">Erase</button>
            </div>
            <div class="mc-hint" id="mc-tool-hint">Click cell edges to toggle walls</div>
          </div>
          <!-- Object Palette -->
          <div class="mc-panel" id="mc-object-palette" style="display:none">
            <div class="mc-panel-title">Objects</div>
            <div class="mc-obj-grid">
              ${OBJECT_PALETTE.map((o, i) =>
                `<button class="mc-obj-btn${i === 0 ? ' active' : ''}" data-idx="${i}" title="${o.label}">${o.sprite}</button>`
              ).join('')}
            </div>
          </div>
          <!-- Quick Actions -->
          <div class="mc-panel">
            <div class="mc-panel-title">Quick Actions</div>
            <button class="mc-btn small" id="mc-fill-solid">Fill All Solid</button>
            <button class="mc-btn small" id="mc-clear-solid">Clear All Solid</button>
            <button class="mc-btn small" id="mc-border-walls">Add Border Walls</button>
          </div>
        </div>
        <div class="mc-canvas-area">
          <canvas id="mc-canvas"></canvas>
        </div>
      </div>
    `;
    this.container.appendChild(this.panel);

    this.canvas = this.panel.querySelector('#mc-canvas');
    this.ctx = this.canvas.getContext('2d');

    this._setupEventListeners();
    this._resizeCanvas();
  }

  _setupEventListeners() {
    // Save / Cancel
    this.panel.querySelector('#mc-save').addEventListener('click', () => this._save());
    this.panel.querySelector('#mc-cancel').addEventListener('click', () => {
      if (this.onCancel) this.onCancel();
    });

    // Resize grid
    this.panel.querySelector('#mc-resize').addEventListener('click', () => {
      const w = parseInt(this.panel.querySelector('#mc-width').value, 10);
      const h = parseInt(this.panel.querySelector('#mc-height').value, 10);
      if (w >= 5 && w <= 100 && h >= 5 && h <= 100) {
        if (w < this.gameMap.width || h < this.gameMap.height) {
          if (!confirm('Shrinking the grid will lose data outside the new bounds. Continue?')) return;
        }
        this._resizeGrid(w, h);
      }
    });

    // Image upload
    this.panel.querySelector('#mc-upload-btn').addEventListener('click', () => {
      this.panel.querySelector('#mc-file-input').click();
    });
    this.panel.querySelector('#mc-file-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this._handleImageUpload(e.target.files[0]);
    });
    this.panel.querySelector('#mc-clear-img').addEventListener('click', () => {
      this.gameMap.backgroundImage = null;
      this.bgImage = null;
      this.panel.querySelector('#mc-clear-img').style.display = 'none';
      this._render();
    });

    // Background sliders
    this.panel.querySelector('#mc-bg-opacity').addEventListener('input', (e) => {
      this.gameMap.bgOpacity = parseInt(e.target.value, 10) / 100;
      this._render();
    });
    this.panel.querySelector('#mc-bg-scale').addEventListener('input', (e) => {
      this.gameMap.bgScale = parseInt(e.target.value, 10) / 100;
      this._render();
    });

    // Tool selection
    this.panel.querySelectorAll('.mc-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.panel.querySelectorAll('.mc-tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = btn.dataset.tool;
        this._updateToolHint();
        this.panel.querySelector('#mc-object-palette').style.display =
          this.activeTool === 'object' ? 'flex' : 'none';
      });
    });

    // Object palette
    this.panel.querySelectorAll('.mc-obj-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.panel.querySelectorAll('.mc-obj-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedObject = OBJECT_PALETTE[parseInt(btn.dataset.idx, 10)];
      });
    });

    // Quick actions
    this.panel.querySelector('#mc-fill-solid').addEventListener('click', () => {
      for (let y = 0; y < this.gameMap.height; y++)
        for (let x = 0; x < this.gameMap.width; x++) {
          const cell = this.gameMap.cells[y][x];
          cell.solid = true;
          cell.walls = WALL_N | WALL_S | WALL_E | WALL_W;
        }
      this._render();
    });
    this.panel.querySelector('#mc-clear-solid').addEventListener('click', () => {
      for (let y = 0; y < this.gameMap.height; y++)
        for (let x = 0; x < this.gameMap.width; x++)
          this.gameMap.cells[y][x].solid = false;
      this._render();
    });
    this.panel.querySelector('#mc-border-walls').addEventListener('click', () => {
      this.gameMap.buildBorderWalls();
      this._render();
    });

    // Canvas interactions
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverGridX = -1;
      this.hoverGridY = -1;
      this.hoverEdge = null;
      this._render();
    });
    this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Window resize
    this._boundHandlers.resize = () => this._resizeCanvas();
    window.addEventListener('resize', this._boundHandlers.resize);
  }

  _updateToolHint() {
    const hints = {
      wall: 'Click cell edges to toggle walls',
      solid: 'Click cells to toggle solid/passable',
      floor: 'Click cells to cycle floor color',
      light: 'Click cells to cycle light level',
      object: 'Click cells to place selected object',
      erase: 'Click cells to remove objects',
    };
    this.panel.querySelector('#mc-tool-hint').textContent = hints[this.activeTool] || '';
  }

  // --- Canvas Sizing ---

  _resizeCanvas() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const area = this.canvas.parentElement;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._render();
  }

  // --- Coordinate Conversion ---

  _screenToWorld(sx, sy) {
    const z = this.camera.zoom;
    const ts = this.tileSize * z;
    return {
      x: (sx + this.camera.x) / ts,
      y: (sy + this.camera.y) / ts,
    };
  }

  // --- Image Upload ---

  _handleImageUpload(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Resize if too large
        const maxDim = 2048;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.floor(w * ratio);
          h = Math.floor(h * ratio);
        }
        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const octx = offscreen.getContext('2d');
        octx.drawImage(img, 0, 0, w, h);
        const dataUrl = offscreen.toDataURL('image/jpeg', 0.7);

        this.gameMap.backgroundImage = dataUrl;
        this._loadBackgroundImage();
        this.panel.querySelector('#mc-clear-img').style.display = 'block';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  _loadBackgroundImage() {
    if (this.gameMap.backgroundImage) {
      const img = new Image();
      img.onload = () => {
        this.bgImage = img;
        this.panel.querySelector('#mc-clear-img').style.display = 'block';
        this._render();
      };
      img.src = this.gameMap.backgroundImage;
    } else {
      this.bgImage = null;
    }
  }

  // --- Grid Resize ---

  _resizeGrid(newW, newH) {
    const oldMap = this.gameMap;
    const newMap = new GameMap(newW, newH);
    // Copy background properties
    newMap.backgroundImage = oldMap.backgroundImage;
    newMap.bgOffsetX = oldMap.bgOffsetX;
    newMap.bgOffsetY = oldMap.bgOffsetY;
    newMap.bgScale = oldMap.bgScale;
    newMap.bgOpacity = oldMap.bgOpacity;
    // Copy overlapping cells
    const overlapW = Math.min(oldMap.width, newW);
    const overlapH = Math.min(oldMap.height, newH);
    for (let y = 0; y < overlapH; y++) {
      for (let x = 0; x < overlapW; x++) {
        const src = oldMap.cells[y][x];
        newMap.cells[y][x] = new Cell({
          walls: src.walls,
          floorColor: src.floorColor,
          ceilingColor: src.ceilingColor,
          wallColor: src.wallColor,
          light: src.light,
          visible: src.visible,
          solid: src.solid,
          objects: [...src.objects],
        });
      }
    }
    this.gameMap = newMap;
    this.panel.querySelector('#mc-width').value = newW;
    this.panel.querySelector('#mc-height').value = newH;
    this._render();
  }

  // --- Mouse Handlers ---

  _onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Shift+drag: move background image
    if (e.shiftKey && this.bgImage) {
      this.isDraggingImage = true;
      this.imgDragLastX = sx;
      this.imgDragLastY = sy;
      this.canvas.style.cursor = 'move';
      e.preventDefault();
      return;
    }

    // Right-click or middle-click: pan
    if (e.button === 2 || e.button === 1) {
      this.isPanning = true;
      this.panLastX = e.clientX;
      this.panLastY = e.clientY;
      this.canvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }
  }

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Image dragging
    if (this.isDraggingImage) {
      const z = this.camera.zoom;
      const ts = this.tileSize * z;
      const dx = (sx - this.imgDragLastX) / ts;
      const dy = (sy - this.imgDragLastY) / ts;
      this.gameMap.bgOffsetX += dx;
      this.gameMap.bgOffsetY += dy;
      this.imgDragLastX = sx;
      this.imgDragLastY = sy;
      this._render();
      return;
    }

    // Panning
    if (this.isPanning) {
      const dx = e.clientX - this.panLastX;
      const dy = e.clientY - this.panLastY;
      this.camera.x -= dx;
      this.camera.y -= dy;
      this.panLastX = e.clientX;
      this.panLastY = e.clientY;
      this._render();
      return;
    }

    // Hover tracking
    const world = this._screenToWorld(sx, sy);
    const gx = Math.floor(world.x);
    const gy = Math.floor(world.y);
    this.hoverGridX = gx;
    this.hoverGridY = gy;

    if (this.activeTool === 'wall' && this.gameMap.inBounds(gx, gy)) {
      const fx = world.x - gx;
      const fy = world.y - gy;
      const threshold = 0.25;
      if (fy < threshold) this.hoverEdge = 'N';
      else if (fy > 1 - threshold) this.hoverEdge = 'S';
      else if (fx < threshold) this.hoverEdge = 'W';
      else if (fx > 1 - threshold) this.hoverEdge = 'E';
      else this.hoverEdge = null;
    } else {
      this.hoverEdge = null;
    }

    this._render();
  }

  _onMouseUp(e) {
    if (this.isDraggingImage) {
      this.isDraggingImage = false;
      this.canvas.style.cursor = '';
    }
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = '';
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const worldBefore = this._screenToWorld(mx, my);
    const dir = e.deltaY < 0 ? 1 : -1;
    this.camera.zoom = Math.min(
      this.zoomMax,
      Math.max(this.zoomMin, this.camera.zoom * (1 + dir * 0.1))
    );
    const newTs = this.tileSize * this.camera.zoom;
    this.camera.x = worldBefore.x * newTs - mx;
    this.camera.y = worldBefore.y * newTs - my;
    this._render();
  }

  _onCanvasClick(e) {
    if (this.isPanning || this.isDraggingImage) return;
    if (e.button !== 0) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this._screenToWorld(sx, sy);
    const gx = Math.floor(world.x);
    const gy = Math.floor(world.y);

    if (!this.gameMap.inBounds(gx, gy)) return;

    const cell = this.gameMap.getCell(gx, gy);

    switch (this.activeTool) {
      case 'wall':
        this._handleWallClick(gx, gy, world.x - gx, world.y - gy);
        break;
      case 'solid':
        cell.solid = !cell.solid;
        if (cell.solid) {
          cell.walls = WALL_N | WALL_S | WALL_E | WALL_W;
        }
        break;
      case 'floor': {
        const idx = FLOOR_COLORS.indexOf(cell.floorColor);
        cell.floorColor = FLOOR_COLORS[(idx + 1) % FLOOR_COLORS.length];
        break;
      }
      case 'light': {
        const idx = LIGHT_LEVELS.findIndex(l => Math.abs(l - cell.light) < 0.05);
        cell.light = LIGHT_LEVELS[(idx + 1) % LIGHT_LEVELS.length];
        break;
      }
      case 'object':
        cell.objects.push({
          type: this.selectedObject.type,
          sprite: this.selectedObject.sprite,
          x: 0.5,
          y: 0.5,
        });
        break;
      case 'erase':
        cell.objects = [];
        break;
    }

    this._render();
  }

  _handleWallClick(gx, gy, fx, fy) {
    const cell = this.gameMap.getCell(gx, gy);
    if (!cell) return;

    const threshold = 0.25;
    let wallFlag = null;

    if (fy < threshold) wallFlag = WALL_N;
    else if (fy > 1 - threshold) wallFlag = WALL_S;
    else if (fx < threshold) wallFlag = WALL_W;
    else if (fx > 1 - threshold) wallFlag = WALL_E;

    if (wallFlag !== null) {
      cell.toggleWall(wallFlag);
      this._mirrorWall(gx, gy, wallFlag);
    }
  }

  _mirrorWall(x, y, flag) {
    const map = this.gameMap;
    if (flag === WALL_N && y > 0) map.getCell(x, y - 1)?.toggleWall(WALL_S);
    if (flag === WALL_S && y < map.height - 1) map.getCell(x, y + 1)?.toggleWall(WALL_N);
    if (flag === WALL_W && x > 0) map.getCell(x - 1, y)?.toggleWall(WALL_E);
    if (flag === WALL_E && x < map.width - 1) map.getCell(x + 1, y)?.toggleWall(WALL_W);
  }

  // --- Save ---

  _save() {
    this.gameMap.syncWalls();
    if (this.onSave) this.onSave(this.gameMap.toJSON());
  }

  // --- Rendering ---

  _render() {
    if (!this.ctx) return;

    const { ctx, gameMap, tileSize, camera } = this;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const z = camera.zoom;
    const ts = tileSize * z;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // --- Background image ---
    if (this.bgImage) {
      ctx.save();
      ctx.globalAlpha = gameMap.bgOpacity;
      const imgW = this.bgImage.width * gameMap.bgScale * (ts / tileSize);
      const imgH = this.bgImage.height * gameMap.bgScale * (ts / tileSize);
      const imgX = gameMap.bgOffsetX * ts;
      const imgY = gameMap.bgOffsetY * ts;
      ctx.drawImage(this.bgImage, imgX, imgY, imgW, imgH);
      ctx.restore();
    }

    // --- Floor tiles / solid blocks ---
    for (let y = 0; y < gameMap.height; y++) {
      for (let x = 0; x < gameMap.width; x++) {
        const cell = gameMap.cells[y][x];
        const px = x * ts;
        const py = y * ts;

        if (cell.solid) {
          ctx.fillStyle = '#111';
          ctx.globalAlpha = 0.85;
          ctx.fillRect(px, py, ts, ts);
          ctx.globalAlpha = 1;
          // Diagonal lines to indicate solid
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + ts, py + ts);
          ctx.moveTo(px + ts, py);
          ctx.lineTo(px, py + ts);
          ctx.stroke();
        } else {
          ctx.fillStyle = cell.floorColor;
          ctx.globalAlpha = Math.max(0.15, cell.light) * 0.7; // slightly transparent to show bg
          ctx.fillRect(px, py, ts, ts);
          ctx.globalAlpha = 1;
        }
      }
    }

    // --- Grid lines ---
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let y = 0; y <= gameMap.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * ts);
      ctx.lineTo(gameMap.width * ts, y * ts);
      ctx.stroke();
    }
    for (let x = 0; x <= gameMap.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * ts, 0);
      ctx.lineTo(x * ts, gameMap.height * ts);
      ctx.stroke();
    }

    // --- Walls ---
    ctx.strokeStyle = '#d4c9a8';
    ctx.lineWidth = 3 * z;
    ctx.lineCap = 'round';

    for (let y = 0; y < gameMap.height; y++) {
      for (let x = 0; x < gameMap.width; x++) {
        const cell = gameMap.cells[y][x];
        if (cell.solid) continue;
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

    // --- Hover highlight ---
    if (this.gameMap.inBounds(this.hoverGridX, this.hoverGridY)) {
      const px = this.hoverGridX * ts;
      const py = this.hoverGridY * ts;

      if (this.activeTool === 'wall' && this.hoverEdge) {
        // Highlight the hovered edge
        ctx.strokeStyle = 'rgba(201, 168, 76, 0.8)';
        ctx.lineWidth = 5 * z;
        ctx.lineCap = 'round';
        ctx.beginPath();
        switch (this.hoverEdge) {
          case 'N': ctx.moveTo(px, py); ctx.lineTo(px + ts, py); break;
          case 'S': ctx.moveTo(px, py + ts); ctx.lineTo(px + ts, py + ts); break;
          case 'W': ctx.moveTo(px, py); ctx.lineTo(px, py + ts); break;
          case 'E': ctx.moveTo(px + ts, py); ctx.lineTo(px + ts, py + ts); break;
        }
        ctx.stroke();
      } else if (this.activeTool !== 'wall') {
        // Highlight the full cell
        ctx.fillStyle = 'rgba(201, 168, 76, 0.15)';
        ctx.fillRect(px, py, ts, ts);
        ctx.strokeStyle = 'rgba(201, 168, 76, 0.5)';
        ctx.lineWidth = 2 * z;
        ctx.strokeRect(px, py, ts, ts);

        // Ghost object preview
        if (this.activeTool === 'object') {
          ctx.globalAlpha = 0.5;
          ctx.font = `${ts * 0.5}px serif`;
          ctx.fillText(this.selectedObject.sprite, px + ts / 2, py + ts / 2);
          ctx.globalAlpha = 1;
        }
      }
    }

    ctx.restore();
  }

  // --- Cleanup ---

  destroy() {
    window.removeEventListener('resize', this._boundHandlers.resize);
    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }
    this.canvas = null;
    this.ctx = null;
    this.bgImage = null;
  }
}
