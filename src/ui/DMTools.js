/**
 * DM map-editing toolbar.
 * Allows the DM to click on the 2D map to toggle walls and adjust cell properties.
 */

import { WALL_N, WALL_S, WALL_E, WALL_W } from '../engine/GameMap.js';

export class DMTools {
  /**
   * @param {HTMLElement} container – DOM element to mount the toolbar into
   * @param {import('../engine/GameMap.js').GameMap} gameMap
   * @param {import('../renderers/MapRenderer2D.js').MapRenderer2D} renderer2d
   */
  constructor(container, gameMap, renderer2d) {
    this.gameMap = gameMap;
    this.renderer2d = renderer2d;
    this.enabled = false;
    this.activeTool = 'wall'; // 'wall' | 'light' | 'floor'

    this._buildUI(container);
  }

  _buildUI(container) {
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'dm-toolbar';
    this.toolbar.innerHTML = `
      <div class="dm-title">DM Tools</div>
      <label class="dm-toggle">
        <input type="checkbox" id="dm-mode-toggle">
        <span>Edit Mode</span>
      </label>
      <div class="dm-tools-group" id="dm-tools-group">
        <button class="dm-btn active" data-tool="wall">Wall</button>
        <button class="dm-btn" data-tool="light">Light</button>
        <button class="dm-btn" data-tool="floor">Floor Color</button>
      </div>
      <div class="dm-hint" id="dm-hint">Click cell edges to toggle walls</div>
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

    // Default: hidden
    this.toolbar.querySelector('#dm-tools-group').style.display = 'none';
    this.toolbar.querySelector('#dm-hint').style.display = 'none';
  }

  _updateHint() {
    const hints = {
      wall: 'Click cell edges to toggle walls',
      light: 'Click cells to cycle light level',
      floor: 'Click cells to cycle floor color',
    };
    this.toolbar.querySelector('#dm-hint').textContent = hints[this.activeTool] || '';
  }

  /**
   * Called from the main app's click handler when DM mode is active.
   * @param {number} screenX
   * @param {number} screenY
   */
  handleClick(screenX, screenY) {
    if (!this.enabled) return false;

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
      return true;
    }

    if (this.activeTool === 'floor') {
      const colors = ['#3a3a2a', '#4a4a3a', '#4a3a2a', '#2a2a2a', '#5a4a1a', '#3a1a3a'];
      const idx = colors.indexOf(cell.floorColor);
      cell.floorColor = colors[(idx + 1) % colors.length];
      return true;
    }

    return false;
  }

  _mirrorWall(x, y, flag) {
    const map = this.gameMap;
    if (flag === WALL_N && y > 0) {
      map.getCell(x, y - 1)?.toggleWall(WALL_S);
    }
    if (flag === WALL_S && y < map.height - 1) {
      map.getCell(x, y + 1)?.toggleWall(WALL_N);
    }
    if (flag === WALL_W && x > 0) {
      map.getCell(x - 1, y)?.toggleWall(WALL_E);
    }
    if (flag === WALL_E && x < map.width - 1) {
      map.getCell(x + 1, y)?.toggleWall(WALL_W);
    }
  }
}
