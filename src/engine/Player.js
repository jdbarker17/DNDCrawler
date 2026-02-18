/**
 * Player state – position in world coordinates and facing angle.
 * Both renderers read from this to know where to draw / cast rays from.
 */

import { WALL_N, WALL_S, WALL_E, WALL_W } from './GameMap.js';

let _nextId = 1;

export class Player {
  constructor(x = 1.5, y = 1.5, angle = 0) {
    this.id = _nextId++;
    this.x = x;         // world-space X (fractional – centre of cell 1 = 1.5)
    this.y = y;         // world-space Y
    this.angle = angle;  // radians, 0 = east, π/2 = south
    this.radius = 0.2;   // collision radius
    this.moveSpeed = 3.0; // cells per second
    this.turnSpeed = 2.5; // radians per second
    this.color = '#e74c3c';
    this.name = 'Player';
    this.token = '';     // emoji token displayed in first-person view
    this.className = ''; // e.g. "Fighter", "Wizard"
  }

  /** Attempt to move forward/backward, with wall collision. */
  move(dir, dt, gameMap) {
    const dx = Math.cos(this.angle) * dir * this.moveSpeed * dt;
    const dy = Math.sin(this.angle) * dir * this.moveSpeed * dt;
    this._tryMove(dx, dy, gameMap);
  }

  /** Attempt to strafe left/right, with wall collision. */
  strafe(dir, dt, gameMap) {
    const perpAngle = this.angle + Math.PI / 2;
    const dx = Math.cos(perpAngle) * dir * this.moveSpeed * dt;
    const dy = Math.sin(perpAngle) * dir * this.moveSpeed * dt;
    this._tryMove(dx, dy, gameMap);
  }

  turn(dir, dt) {
    this.angle += dir * this.turnSpeed * dt;
  }

  /**
   * Slide-based collision: try X then Y independently so the player
   * slides along walls instead of stopping dead.
   */
  _tryMove(dx, dy, gameMap) {
    const newX = this.x + dx;
    const newY = this.y + dy;

    if (!this._collides(newX, this.y, gameMap)) {
      this.x = newX;
    }
    if (!this._collides(this.x, newY, gameMap)) {
      this.y = newY;
    }
  }

  /**
   * Check whether the player circle at (px, py) intersects any wall segment.
   */
  _collides(px, py, gameMap) {
    const r = this.radius;

    // Check the four corners of the bounding box
    const minCX = Math.floor(px - r);
    const maxCX = Math.floor(px + r);
    const minCY = Math.floor(py - r);
    const maxCY = Math.floor(py + r);

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const cell = gameMap.getCell(cx, cy);
        if (!cell) return true; // out of bounds = solid

        // Check walls of this cell vs the player circle
        // North wall: at y = cy
        if (cell.hasWall(WALL_N) && py - r < cy && py > cy - 0.5 && px + r > cx && px - r < cx + 1) {
          return true;
        }
        // South wall: at y = cy + 1
        if (cell.hasWall(WALL_S) && py + r > cy + 1 && py < cy + 1.5 && px + r > cx && px - r < cx + 1) {
          return true;
        }
        // West wall: at x = cx
        if (cell.hasWall(WALL_W) && px - r < cx && px > cx - 0.5 && py + r > cy && py - r < cy + 1) {
          return true;
        }
        // East wall: at x = cx + 1
        if (cell.hasWall(WALL_E) && px + r > cx + 1 && px < cx + 1.5 && py + r > cy && py - r < cy + 1) {
          return true;
        }
      }
    }
    return false;
  }
}
