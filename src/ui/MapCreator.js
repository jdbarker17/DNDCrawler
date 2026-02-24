/**
 * Full-screen map editor for DMs.
 * Allows uploading a background image, painting walls/solidity/floors/objects,
 * resizing the grid, and saving the result as a GameMap.
 */

import { GameMap, Cell, WALL_N, WALL_S, WALL_E, WALL_W } from '../engine/GameMap.js';
import { MapLibrary } from './MapLibrary.js';

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

    // Drag-painting state
    this.isPainting = false;
    this.paintWallAdd = true; // true = adding walls, false = removing
    this.lastPaintKey = null; // "gx,gy,edge" to avoid re-toggling same wall
    this.paintAxis = null; // 'H' (N/S edges) or 'V' (E/W edges) — locks drag direction

    this._boundHandlers = {};
    this._buildUI();
    this._loadBackgroundImage();
    this._render();
  }

  _createBlankMap(w, h) {
    const map = new GameMap(w, h);
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
          <button class="mc-btn" id="mc-save-library">Save to Library</button>
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
          <!-- Map Library -->
          <div class="mc-panel">
            <div class="mc-panel-title">Map Library</div>
            <button class="mc-btn small" id="mc-browse-library">Browse Library</button>
          </div>
          <!-- Quick Actions -->
          <div class="mc-panel">
            <div class="mc-panel-title">Quick Actions</div>
            <button class="mc-btn small" id="mc-new-map">New Map</button>
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
    // Save / Cancel / Library
    this.panel.querySelector('#mc-save').addEventListener('click', () => this._save());
    this.panel.querySelector('#mc-cancel').addEventListener('click', () => {
      if (this.onCancel) this.onCancel();
    });
    this.panel.querySelector('#mc-save-library').addEventListener('click', () => {
      this._openLibrary('save');
    });
    this.panel.querySelector('#mc-browse-library').addEventListener('click', () => {
      this._openLibrary('browse');
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
    this.panel.querySelector('#mc-new-map').addEventListener('click', () => {
      const hasWork = this._mapHasContent() || this.gameMap.backgroundImage;
      if (hasWork && !confirm('Create a new blank map? All current work will be lost.')) return;
      const w = parseInt(this.panel.querySelector('#mc-width').value, 10) || 20;
      const h = parseInt(this.panel.querySelector('#mc-height').value, 10) || 20;
      this.gameMap = this._createBlankMap(w, h);
      this.bgImage = null;
      this.panel.querySelector('#mc-width').value = w;
      this.panel.querySelector('#mc-height').value = h;
      this.panel.querySelector('#mc-bg-opacity').value = 50;
      this.panel.querySelector('#mc-bg-scale').value = 100;
      this.panel.querySelector('#mc-clear-img').style.display = 'none';
      this.camera = { x: 0, y: 0, zoom: 1 };
      this._render();
    });
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
        for (let x = 0; x < this.gameMap.width; x++) {
          const cell = this.gameMap.cells[y][x];
          cell.solid = false;
          cell.walls = 0;
          cell.objects = [];
        }
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
        // Ask user if they want to clear existing work
        const hasExistingWork = this._mapHasContent();
        if (hasExistingWork) {
          const clearIt = confirm(
            'Clear existing map content?\n\n' +
            'OK = Start fresh with this image\n' +
            'Cancel = Keep existing walls/objects and just change the background'
          );
          if (clearIt) {
            this._resetMapContent();
          }
        }

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

        // Fit the image to the grid: scale so the image covers exactly
        // the grid's width × height cells (1 cell = tileSize pixels).
        // bgScale is relative to the tileSize, so bgScale=1 means
        // 1 image-pixel = 1 world-pixel at tileSize.
        const gridW = this.gameMap.width * this.tileSize;
        const gridH = this.gameMap.height * this.tileSize;
        const scaleToFit = Math.min(gridW / w, gridH / h);
        this.gameMap.bgScale = scaleToFit;
        this.gameMap.bgOffsetX = 0;
        this.gameMap.bgOffsetY = 0;

        // Update sidebar controls
        this.panel.querySelector('#mc-bg-scale').value = Math.round(this.gameMap.bgScale * 100);

        this._loadBackgroundImage();
        this.panel.querySelector('#mc-clear-img').style.display = 'block';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  _mapHasContent() {
    for (let y = 0; y < this.gameMap.height; y++) {
      for (let x = 0; x < this.gameMap.width; x++) {
        const cell = this.gameMap.cells[y][x];
        if (cell.walls !== 0) return true;
        if (cell.solid) return true;
        if (cell.objects.length > 0) return true;
      }
    }
    return false;
  }

  _resetMapContent() {
    const w = this.gameMap.width;
    const h = this.gameMap.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = this.gameMap.cells[y][x];
        cell.walls = 0;
        cell.solid = false;
        cell.objects = [];
        cell.floorColor = '#3a3a2a';
        cell.light = 1.0;
      }
    }
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
    newMap.backgroundImage = oldMap.backgroundImage;
    newMap.bgOffsetX = 0;
    newMap.bgOffsetY = 0;
    newMap.bgOpacity = oldMap.bgOpacity;
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

    // Recalculate bgScale so the image fits the new grid dimensions
    if (this.bgImage) {
      const gridW = newW * this.tileSize;
      const gridH = newH * this.tileSize;
      newMap.bgScale = Math.min(gridW / this.bgImage.width, gridH / this.bgImage.height);
      this.panel.querySelector('#mc-bg-scale').value = Math.round(newMap.bgScale * 100);
    }

    this.panel.querySelector('#mc-width').value = newW;
    this.panel.querySelector('#mc-height').value = newH;
    this._render();
  }

  // --- Mouse Handlers ---

  _onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.shiftKey && this.bgImage) {
      this.isDraggingImage = true;
      this.imgDragLastX = sx;
      this.imgDragLastY = sy;
      this.canvas.style.cursor = 'move';
      e.preventDefault();
      return;
    }

    if (e.button === 2 || e.button === 1) {
      this.isPanning = true;
      this.panLastX = e.clientX;
      this.panLastY = e.clientY;
      this.canvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }

    // Left-click: start drag-painting for wall tool
    if (e.button === 0 && this.activeTool === 'wall') {
      const world = this._screenToWorld(sx, sy);
      const gx = Math.floor(world.x);
      const gy = Math.floor(world.y);
      if (this.gameMap.inBounds(gx, gy)) {
        const fx = world.x - gx;
        const fy = world.y - gy;
        const edge = this._getEdge(fx, fy);
        if (edge) {
          const cell = this.gameMap.getCell(gx, gy);
          const flag = this._edgeToFlag(edge);
          // Determine if we're adding or removing based on current state
          this.paintWallAdd = !cell.hasWall(flag);
          this.isPainting = true;
          this.lastPaintKey = `${gx},${gy},${edge}`;
          // Lock axis: N/S edges = horizontal wall lines, E/W edges = vertical wall lines
          this.paintAxis = (edge === 'N' || edge === 'S') ? 'H' : 'V';
          this._applyWallPaint(gx, gy, edge);
          this._render();
          e.preventDefault();
        }
      }
    }

    // Left-click: start drag-erasing
    if (e.button === 0 && this.activeTool === 'erase') {
      const world = this._screenToWorld(sx, sy);
      const gx = Math.floor(world.x);
      const gy = Math.floor(world.y);
      if (this.gameMap.inBounds(gx, gy)) {
        this.isPainting = true;
        this.lastPaintKey = `${gx},${gy}`;
        this._eraseCell(gx, gy);
        this._render();
        e.preventDefault();
      }
    }
  }

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

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

    const world = this._screenToWorld(sx, sy);
    const gx = Math.floor(world.x);
    const gy = Math.floor(world.y);
    this.hoverGridX = gx;
    this.hoverGridY = gy;

    if (this.activeTool === 'wall' && this.gameMap.inBounds(gx, gy)) {
      const fx = world.x - gx;
      const fy = world.y - gy;
      const edge = this._getEdge(fx, fy);

      // While drag-painting, only show and apply edges on the locked axis
      if (this.isPainting && this.paintAxis && edge) {
        const edgeAxis = (edge === 'N' || edge === 'S') ? 'H' : 'V';
        if (edgeAxis === this.paintAxis) {
          this.hoverEdge = edge;
          const key = `${gx},${gy},${edge}`;
          if (key !== this.lastPaintKey) {
            this.lastPaintKey = key;
            this._applyWallPaint(gx, gy, edge);
          }
        } else {
          this.hoverEdge = null;
        }
      } else {
        this.hoverEdge = edge;
      }
    } else {
      this.hoverEdge = null;
    }

    // Drag-erase across cells
    if (this.isPainting && this.activeTool === 'erase' && this.gameMap.inBounds(gx, gy)) {
      const key = `${gx},${gy}`;
      if (key !== this.lastPaintKey) {
        this.lastPaintKey = key;
        this._eraseCell(gx, gy);
      }
    }

    this._render();
  }

  _onMouseUp() {
    if (this.isDraggingImage) {
      this.isDraggingImage = false;
      this.canvas.style.cursor = '';
    }
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = '';
    }
    if (this.isPainting) {
      this.isPainting = false;
      this.lastPaintKey = null;
      this.paintAxis = null;
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
    // Wall and erase tools are handled by mousedown/mousemove drag-painting
    if (this.activeTool === 'wall' || this.activeTool === 'erase') return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this._screenToWorld(sx, sy);
    const gx = Math.floor(world.x);
    const gy = Math.floor(world.y);

    if (!this.gameMap.inBounds(gx, gy)) return;

    const cell = this.gameMap.getCell(gx, gy);

    switch (this.activeTool) {
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
      // erase is handled by drag-painting in mousedown/mousemove
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

  _eraseCell(gx, gy) {
    const cell = this.gameMap.getCell(gx, gy);
    if (!cell) return;
    cell.objects = [];
    cell.walls = 0;
    cell.solid = false;
    this._clearMirroredWalls(gx, gy);
  }

  _clearMirroredWalls(x, y) {
    const map = this.gameMap;
    if (y > 0) { const n = map.getCell(x, y - 1); if (n && n.hasWall(WALL_S)) n.toggleWall(WALL_S); }
    if (y < map.height - 1) { const s = map.getCell(x, y + 1); if (s && s.hasWall(WALL_N)) s.toggleWall(WALL_N); }
    if (x > 0) { const w = map.getCell(x - 1, y); if (w && w.hasWall(WALL_E)) w.toggleWall(WALL_E); }
    if (x < map.width - 1) { const e = map.getCell(x + 1, y); if (e && e.hasWall(WALL_W)) e.toggleWall(WALL_W); }
  }

  _getEdge(fx, fy) {
    const threshold = 0.25;
    if (fy < threshold) return 'N';
    if (fy > 1 - threshold) return 'S';
    if (fx < threshold) return 'W';
    if (fx > 1 - threshold) return 'E';
    return null;
  }

  _edgeToFlag(edge) {
    switch (edge) {
      case 'N': return WALL_N;
      case 'S': return WALL_S;
      case 'E': return WALL_E;
      case 'W': return WALL_W;
    }
    return null;
  }

  _applyWallPaint(gx, gy, edge) {
    const cell = this.gameMap.getCell(gx, gy);
    if (!cell) return;
    const flag = this._edgeToFlag(edge);
    if (flag === null) return;
    const has = cell.hasWall(flag);
    if (this.paintWallAdd && !has) {
      cell.toggleWall(flag);
      this._mirrorWall(gx, gy, flag);
    } else if (!this.paintWallAdd && has) {
      cell.toggleWall(flag);
      this._mirrorWall(gx, gy, flag);
    }
  }

  // --- Library ---

  _openLibrary(mode) {
    if (this.library) return; // already open

    this.gameMap.syncWalls();
    const saveContext = (mode === 'save')
      ? { mapData: this.gameMap.toJSON(), defaultName: '' }
      : null;

    this.library = new MapLibrary(
      this.panel,
      (mapData) => {
        // Load map into the editor
        this.gameMap = GameMap.fromJSON(mapData);
        this._loadBackgroundImage();
        this.panel.querySelector('#mc-width').value = this.gameMap.width;
        this.panel.querySelector('#mc-height').value = this.gameMap.height;
        this.panel.querySelector('#mc-bg-opacity').value = Math.round(this.gameMap.bgOpacity * 100);
        this.panel.querySelector('#mc-bg-scale').value = Math.round(this.gameMap.bgScale * 100);
        this._render();
      },
      () => {
        // Close library
        if (this.library) {
          this.library.destroy();
          this.library = null;
        }
      },
      saveContext
    );
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
          ctx.globalAlpha = Math.max(0.15, cell.light) * 0.7;
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
        ctx.fillStyle = 'rgba(201, 168, 76, 0.15)';
        ctx.fillRect(px, py, ts, ts);
        ctx.strokeStyle = 'rgba(201, 168, 76, 0.5)';
        ctx.lineWidth = 2 * z;
        ctx.strokeRect(px, py, ts, ts);

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
    if (this.library) {
      this.library.destroy();
      this.library = null;
    }
    window.removeEventListener('resize', this._boundHandlers.resize);
    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }
    this.canvas = null;
    this.ctx = null;
    this.bgImage = null;
  }
}
