/**
 * Shared map data model consumed by both the 2D and first-person renderers.
 *
 * The map is a grid of cells. Each cell stores wall flags (N/S/E/W),
 * texture IDs, object lists, and lighting info. A companion `wallTextures`
 * map lets renderers look up colours / images by ID.
 */

// Wall flag bitmask constants
export const WALL_N = 0b0001;
export const WALL_S = 0b0010;
export const WALL_E = 0b0100;
export const WALL_W = 0b1000;

export class Cell {
  constructor({
    walls = 0,
    floorColor = '#3a3a2a',
    ceilingColor = '#1a1a1a',
    wallColor = '#6b6b6b',
    objects = [],
    light = 1.0,
    visible = true,
    solid = false,
  } = {}) {
    this.walls = walls;           // bitmask of WALL_N | WALL_S | ...
    this.floorColor = floorColor;
    this.ceilingColor = ceilingColor;
    this.wallColor = wallColor;
    this.objects = objects;        // array of { type, sprite, x, y }
    this.light = light;           // 0..1 ambient light multiplier
    this.visible = visible;       // DM can hide cells entirely
    this.solid = solid;           // true = solid rock block (no passable floor)
  }

  hasWall(flag) {
    return (this.walls & flag) !== 0;
  }

  toggleWall(flag) {
    this.walls ^= flag;
  }

  setWall(flag, on) {
    if (on) this.walls |= flag;
    else this.walls &= ~flag;
  }
}

export class GameMap {
  /**
   * @param {number} width  – number of columns
   * @param {number} height – number of rows
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cellSize = 1; // world-unit size of each cell (used by renderers)
    this.cells = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        row.push(new Cell());
      }
      this.cells.push(row);
    }
  }

  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getCell(x, y) {
    if (!this.inBounds(x, y)) return null;
    return this.cells[y][x];
  }

  /**
   * Build walls along the map border so the player can never walk off-edge.
   */
  buildBorderWalls() {
    for (let x = 0; x < this.width; x++) {
      this.cells[0][x].setWall(WALL_N, true);
      this.cells[this.height - 1][x].setWall(WALL_S, true);
    }
    for (let y = 0; y < this.height; y++) {
      this.cells[y][0].setWall(WALL_W, true);
      this.cells[y][this.width - 1].setWall(WALL_E, true);
    }
  }

  /**
   * Ensure that a wall placed on one cell face is mirrored on the
   * adjacent cell (e.g. cell(2,3).WALL_E ↔ cell(3,3).WALL_W).
   */
  syncWalls() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y][x];
        if (cell.hasWall(WALL_E) && x + 1 < this.width)
          this.cells[y][x + 1].setWall(WALL_W, true);
        if (cell.hasWall(WALL_W) && x - 1 >= 0)
          this.cells[y][x - 1].setWall(WALL_E, true);
        if (cell.hasWall(WALL_S) && y + 1 < this.height)
          this.cells[y + 1][x].setWall(WALL_N, true);
        if (cell.hasWall(WALL_N) && y - 1 >= 0)
          this.cells[y - 1][x].setWall(WALL_S, true);
      }
    }
  }

  /** Serialise to a plain object (for saving / networking later). */
  toJSON() {
    return {
      width: this.width,
      height: this.height,
      cells: this.cells.map(row =>
        row.map(c => ({
          walls: c.walls,
          floorColor: c.floorColor,
          ceilingColor: c.ceilingColor,
          wallColor: c.wallColor,
          light: c.light,
          visible: c.visible,
          solid: c.solid,
          objects: c.objects,
        }))
      ),
    };
  }

  static fromJSON(data) {
    const map = new GameMap(data.width, data.height);
    for (let y = 0; y < data.height; y++) {
      for (let x = 0; x < data.width; x++) {
        const src = data.cells[y][x];
        map.cells[y][x] = new Cell(src);
      }
    }
    return map;
  }
}
