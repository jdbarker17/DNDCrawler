/**
 * DM map-editing toolbar.
 * Allows the DM to click on the 2D map to toggle walls and adjust cell properties.
 * Only rendered for users with the 'dm' role.
 */

import { WALL_N, WALL_S, WALL_E, WALL_W, GameMap } from '../engine/GameMap.js';

export class DMTools {
  /**
   * @param {HTMLElement} container – DOM element to mount the toolbar into
   * @param {import('../engine/GameMap.js').GameMap} gameMap
   * @param {import('../renderers/MapRenderer2D.js').MapRenderer2D} renderer2d
   * @param {string} role – 'dm' | 'player'
   * @param {(enabled: boolean) => void} [onActionModeToggle] – callback when Action Mode is toggled
   * @param {() => void} [onEditMap] – callback to open map editor
   * @param {(x: number, y: number, cellData: object) => void} [onCellEdit] – callback when a cell is edited (real-time broadcast)
   * @param {(mapData: object) => void} [onMapSwitch] – callback when DM switches to a different map
   */
  constructor(container, gameMap, renderer2d, role = 'dm', onActionModeToggle = null, onEditMap = null, onCellEdit = null, onMapSwitch = null) {
    this.gameMap = gameMap;
    this.renderer2d = renderer2d;
    this.enabled = false;
    this.activeTool = 'wall'; // 'wall' | 'light' | 'floor' | 'fog' | 'objvis' | 'drag'
    this.role = role;
    this.onActionModeToggle = onActionModeToggle;
    this.onEditMap = onEditMap;
    this.onCellEdit = onCellEdit;
    this.onMapSwitch = onMapSwitch;
    this.actionModeEnabled = false;

    // Only build UI for DM
    if (this.role === 'dm') {
      this._buildUI(container);
    }
  }

  _buildUI(container) {
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'dm-toolbar';
    this.toolbar.innerHTML = `
      <div class="dm-title">DM Tools</div>
      <div class="dm-map-select-row">
        <select id="dm-map-select" class="dm-map-select">
          <option value="">— Switch Map —</option>
        </select>
      </div>
      <div id="dm-map-preview" class="dm-map-preview" style="display:none">
        <div class="dm-map-preview-header">
          <span id="dm-map-preview-name" class="dm-map-preview-name"></span>
          <span id="dm-map-preview-size" class="dm-map-preview-size"></span>
        </div>
        <canvas id="dm-map-preview-canvas" class="dm-map-preview-canvas" width="220" height="140"></canvas>
        <div class="dm-map-preview-actions">
          <button class="dm-btn dm-map-preview-switch" id="dm-map-preview-switch">Switch</button>
          <button class="dm-btn dm-map-preview-cancel" id="dm-map-preview-cancel">Cancel</button>
        </div>
      </div>
      <label class="dm-toggle">
        <input type="checkbox" id="dm-mode-toggle">
        <span>Edit Mode</span>
      </label>
      <div class="dm-tools-group" id="dm-tools-group">
        <button class="dm-btn active" data-tool="wall">Wall</button>
        <button class="dm-btn" data-tool="light">Light</button>
        <button class="dm-btn" data-tool="floor">Floor Color</button>
        <button class="dm-btn" data-tool="fog">Fog</button>
        <button class="dm-btn" data-tool="objvis">Obj Vis</button>
      </div>
      <div class="dm-hint" id="dm-hint">Click cell edges to toggle walls</div>
      <div class="dm-divider"></div>
      <label class="dm-toggle dm-action-toggle">
        <input type="checkbox" id="dm-action-mode-toggle">
        <span>Action Mode</span>
      </label>
      <button class="dm-btn dm-drag-btn" id="dm-drag-btn" style="display:none">Drag Player</button>
      <div class="dm-divider"></div>
      <button class="dm-btn dm-edit-map-btn" id="dm-edit-map">Edit Map</button>
    `;
    container.appendChild(this.toolbar);

    // Toggle edit mode
    this.toolbar.querySelector('#dm-mode-toggle').addEventListener('change', (e) => {
      this.enabled = e.target.checked;
      this.toolbar.querySelector('#dm-tools-group').style.display = this.enabled ? 'flex' : 'none';
      this.toolbar.querySelector('#dm-hint').style.display = this.enabled ? 'block' : 'none';
    });

    // Tool selection
    this.toolbar.querySelectorAll('.dm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.toolbar.querySelectorAll('.dm-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = btn.dataset.tool;
        this._updateHint();
      });
    });

    // Action Mode toggle
    this.toolbar.querySelector('#dm-action-mode-toggle').addEventListener('change', (e) => {
      this.actionModeEnabled = e.target.checked;
      this.toolbar.querySelector('#dm-drag-btn').style.display = this.actionModeEnabled ? 'inline-block' : 'none';
      if (this.onActionModeToggle) {
        this.onActionModeToggle(this.actionModeEnabled);
      }
    });

    // Drag Player button — toggles drag tool
    this.toolbar.querySelector('#dm-drag-btn').addEventListener('click', () => {
      const dragBtn = this.toolbar.querySelector('#dm-drag-btn');
      const isDragActive = this.activeTool === 'drag';
      if (isDragActive) {
        // Deactivate drag tool
        this.activeTool = 'wall';
        dragBtn.classList.remove('active');
      } else {
        // Activate drag tool — deactivate edit tools
        this.toolbar.querySelectorAll('.dm-btn').forEach(b => b.classList.remove('active'));
        dragBtn.classList.add('active');
        this.activeTool = 'drag';
      }
      this._updateHint();
    });

    // Edit Map button
    this.toolbar.querySelector('#dm-edit-map').addEventListener('click', () => {
      if (this.onEditMap) this.onEditMap();
    });

    // Map selector dropdown — show preview instead of switching immediately
    this._pendingMapData = null;
    this.toolbar.querySelector('#dm-map-select').addEventListener('change', async (e) => {
      const mapId = parseInt(e.target.value, 10);
      const preview = this.toolbar.querySelector('#dm-map-preview');
      if (!mapId || !this._getSavedMap) {
        preview.style.display = 'none';
        this._pendingMapData = null;
        return;
      }
      try {
        const mapRecord = await this._getSavedMap(mapId);
        if (mapRecord && mapRecord.map_data) {
          const mapData = typeof mapRecord.map_data === 'string'
            ? JSON.parse(mapRecord.map_data)
            : mapRecord.map_data;
          this._pendingMapData = mapData;

          // Show preview panel
          this.toolbar.querySelector('#dm-map-preview-name').textContent = mapRecord.name;
          this.toolbar.querySelector('#dm-map-preview-size').textContent = `${mapData.width}×${mapData.height}`;
          preview.style.display = 'flex';

          // Draw mini map preview
          this._drawMapPreview(mapData);
        }
      } catch (err) {
        console.error('Failed to load map preview:', err);
        preview.style.display = 'none';
      }
    });

    // Preview "Switch" button — confirm the map switch
    this.toolbar.querySelector('#dm-map-preview-switch').addEventListener('click', () => {
      if (this._pendingMapData && this.onMapSwitch) {
        this.onMapSwitch(this._pendingMapData);
      }
      this._pendingMapData = null;
      this.toolbar.querySelector('#dm-map-preview').style.display = 'none';
      this.toolbar.querySelector('#dm-map-select').value = '';
    });

    // Preview "Cancel" button — dismiss
    this.toolbar.querySelector('#dm-map-preview-cancel').addEventListener('click', () => {
      this._pendingMapData = null;
      this.toolbar.querySelector('#dm-map-preview').style.display = 'none';
      this.toolbar.querySelector('#dm-map-select').value = '';
    });

    // Default: hidden
    this.toolbar.querySelector('#dm-tools-group').style.display = 'none';
    this.toolbar.querySelector('#dm-hint').style.display = 'none';
  }

  _updateHint() {
    const hints = {
      wall: 'Click cell edges to toggle walls',
      light: 'Click cells to cycle light level',
      floor: 'Click cells to cycle floor color',
      fog: 'Click cells to toggle fog of war',
      objvis: 'Click cells to toggle object visibility',
      drag: 'Click and drag player tokens to move them',
    };
    if (this.toolbar) {
      this.toolbar.querySelector('#dm-hint').textContent = hints[this.activeTool] || '';
    }
  }

  /**
   * Called from the main app's click handler when DM mode is active.
   * @param {number} screenX
   * @param {number} screenY
   */
  /** Serialize a cell for broadcasting. */
  _serializeCell(cell) {
    return {
      walls: cell.walls,
      floorColor: cell.floorColor,
      ceilingColor: cell.ceilingColor,
      wallColor: cell.wallColor,
      light: cell.light,
      visible: cell.visible,
      solid: cell.solid,
      objects: cell.objects,
    };
  }

  /** Emit a cell edit via the onCellEdit callback. */
  _emitCellEdit(x, y) {
    if (this.onCellEdit) {
      const cell = this.gameMap.getCell(x, y);
      if (cell) this.onCellEdit(x, y, this._serializeCell(cell));
    }
  }

  handleClick(screenX, screenY) {
    if (!this.enabled || this.role !== 'dm') return false;

    const world = this.renderer2d.screenToWorld(screenX, screenY);
    const gridX = Math.floor(world.x);
    const gridY = Math.floor(world.y);

    const cell = this.gameMap.getCell(gridX, gridY);
    if (!cell) return false;

    if (this.activeTool === 'wall') {
      // Determine which edge of the cell was clicked
      const fx = world.x - gridX; // fractional position within cell
      const fy = world.y - gridY;

      const edgeThreshold = 0.2;
      let wallFlag = null;

      if (fy < edgeThreshold) wallFlag = WALL_N;
      else if (fy > 1 - edgeThreshold) wallFlag = WALL_S;
      else if (fx < edgeThreshold) wallFlag = WALL_W;
      else if (fx > 1 - edgeThreshold) wallFlag = WALL_E;

      if (wallFlag !== null) {
        cell.toggleWall(wallFlag);
        this._emitCellEdit(gridX, gridY);
        // Mirror on adjacent cell
        this._mirrorWall(gridX, gridY, wallFlag);
        return true;
      }
    }

    if (this.activeTool === 'light') {
      // Cycle light: 0.2 → 0.5 → 0.8 → 1.0 → 0.2
      const levels = [0.2, 0.5, 0.8, 1.0];
      const idx = levels.findIndex(l => Math.abs(l - cell.light) < 0.05);
      cell.light = levels[(idx + 1) % levels.length];
      this._emitCellEdit(gridX, gridY);
      return true;
    }

    if (this.activeTool === 'floor') {
      const colors = ['#3a3a2a', '#4a4a3a', '#4a3a2a', '#2a2a2a', '#5a4a1a', '#3a1a3a'];
      const idx = colors.indexOf(cell.floorColor);
      cell.floorColor = colors[(idx + 1) % colors.length];
      this._emitCellEdit(gridX, gridY);
      return true;
    }

    if (this.activeTool === 'fog') {
      // Toggle fog of war: visible ↔ hidden
      cell.visible = !cell.visible;
      this._emitCellEdit(gridX, gridY);
      return true;
    }

    if (this.activeTool === 'objvis') {
      // Toggle hidden flag on all objects in this cell
      for (const obj of cell.objects) {
        obj.hidden = !obj.hidden;
      }
      this._emitCellEdit(gridX, gridY);
      return true;
    }

    return false;
  }

  /** Programmatically set the Action Mode toggle (e.g. from TurnTracker ending). */
  setActionMode(enabled) {
    this.actionModeEnabled = enabled;
    if (!this.toolbar) return;
    const toggle = this.toolbar.querySelector('#dm-action-mode-toggle');
    if (toggle) toggle.checked = enabled;
    const dragBtn = this.toolbar.querySelector('#dm-drag-btn');
    if (dragBtn) dragBtn.style.display = enabled ? 'inline-block' : 'none';
    if (!enabled && this.activeTool === 'drag') {
      this.activeTool = 'wall';
      if (dragBtn) dragBtn.classList.remove('active');
    }
  }

  _mirrorWall(x, y, flag) {
    const map = this.gameMap;
    if (flag === WALL_N && y > 0) {
      map.getCell(x, y - 1)?.toggleWall(WALL_S);
      this._emitCellEdit(x, y - 1);
    }
    if (flag === WALL_S && y < map.height - 1) {
      map.getCell(x, y + 1)?.toggleWall(WALL_N);
      this._emitCellEdit(x, y + 1);
    }
    if (flag === WALL_W && x > 0) {
      map.getCell(x - 1, y)?.toggleWall(WALL_E);
      this._emitCellEdit(x - 1, y);
    }
    if (flag === WALL_E && x < map.width - 1) {
      map.getCell(x + 1, y)?.toggleWall(WALL_W);
      this._emitCellEdit(x + 1, y);
    }
  }

  /**
   * Load the list of saved maps into the map selector dropdown.
   * @param {Function} getSavedMaps – async function returning [{ id, name, width, height }]
   * @param {Function} getSavedMap – async function returning a single map record by ID
   */
  async loadMapList(getSavedMaps, getSavedMap) {
    if (!this.toolbar) return;
    this._getSavedMap = getSavedMap; // Store for map selection handler
    const select = this.toolbar.querySelector('#dm-map-select');
    if (!select) return;

    try {
      const maps = await getSavedMaps();
      // Clear old options (keep the first "Switch Map" option)
      while (select.options.length > 1) select.remove(1);
      for (const m of maps) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.width}×${m.height})`;
        select.appendChild(opt);
      }
    } catch (err) {
      console.error('Failed to load saved maps:', err);
    }
  }

  /**
   * Draw a mini preview of a map onto the preview canvas.
   * Shows floor tiles, walls, objects, and background image.
   */
  _drawMapPreview(mapData) {
    const canvas = this.toolbar.querySelector('#dm-map-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Match canvas resolution to its display size for crisp rendering
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cw = rect.width;
    const ch = rect.height;

    // Compute tile size to fit the map into the canvas
    const mapW = mapData.width;
    const mapH = mapData.height;
    const ts = Math.min(cw / mapW, ch / mapH);
    const offsetX = (cw - mapW * ts) / 2;
    const offsetY = (ch - mapH * ts) / 2;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(offsetX, offsetY);

    // Background image (if present)
    if (mapData.backgroundImage) {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.globalAlpha = mapData.bgOpacity ?? 0.5;
        const imgW = img.width * (mapData.bgScale ?? 1) * (ts / 40);
        const imgH = img.height * (mapData.bgScale ?? 1) * (ts / 40);
        const imgX = (mapData.bgOffsetX ?? 0) * ts;
        const imgY = (mapData.bgOffsetY ?? 0) * ts;
        ctx.drawImage(img, imgX, imgY, imgW, imgH);
        ctx.restore();

        // Re-draw floor + walls on top after bg loads
        this._drawMapPreviewCells(ctx, mapData, ts, mapW, mapH);
      };
      img.src = mapData.backgroundImage;
    }

    // Draw cells (floor + walls) immediately (may be re-drawn after bg loads)
    this._drawMapPreviewCells(ctx, mapData, ts, mapW, mapH);

    ctx.restore();
  }

  /** Helper: draw floor tiles, objects, and walls for map preview. */
  _drawMapPreviewCells(ctx, mapData, ts, mapW, mapH) {
    const cells = mapData.cells;

    // Floor tiles
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const cell = cells[y][x];
        const px = x * ts;
        const py = y * ts;

        if (cell.solid) {
          ctx.fillStyle = '#111';
        } else {
          ctx.fillStyle = cell.floorColor || '#3a3a2a';
          // Apply light level
          const light = cell.light ?? 1;
          if (light < 1) ctx.globalAlpha = 0.3 + light * 0.7;
        }
        ctx.fillRect(px, py, ts, ts);
        ctx.globalAlpha = 1;

        // Fog overlay
        if (!cell.visible) {
          ctx.fillStyle = 'rgba(0, 0, 40, 0.5)';
          ctx.fillRect(px, py, ts, ts);
        }
      }
    }

    // Objects (emoji)
    if (ts >= 4) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(ts * 0.5, 4)}px serif`;
      for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
          const cell = cells[y][x];
          for (const obj of (cell.objects || [])) {
            if (obj.hidden) continue;
            const ox = (x + (obj.x ?? 0.5)) * ts;
            const oy = (y + (obj.y ?? 0.5)) * ts;
            ctx.fillText(obj.sprite, ox, oy);
          }
        }
      }
    }

    // Walls
    ctx.strokeStyle = '#d4c9a8';
    ctx.lineWidth = Math.max(1, ts * 0.06);
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const cell = cells[y][x];
        const px = x * ts;
        const py = y * ts;
        const w = cell.walls || 0;

        if (w & 0b0001) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ts, py); ctx.stroke(); }           // N
        if (w & 0b0010) { ctx.beginPath(); ctx.moveTo(px, py + ts); ctx.lineTo(px + ts, py + ts); ctx.stroke(); } // S
        if (w & 0b0100) { ctx.beginPath(); ctx.moveTo(px + ts, py); ctx.lineTo(px + ts, py + ts); ctx.stroke(); } // E
        if (w & 0b1000) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + ts); ctx.stroke(); }           // W
      }
    }
  }
}
