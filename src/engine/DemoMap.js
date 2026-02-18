/**
 * Generates a sample dungeon map for prototyping.
 * A small dungeon with rooms and corridors.
 */

import { GameMap, Cell, WALL_N, WALL_S, WALL_E, WALL_W } from './GameMap.js';

export function createDemoMap() {
  const map = new GameMap(16, 16);

  // Fill everything as solid rock (not passable, not carved)
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.cells[y][x] = new Cell({
        walls: WALL_N | WALL_S | WALL_E | WALL_W,
        wallColor: '#6b6b6b',
        floorColor: '#1a1a1a',
        light: 0.0,
        solid: true, // solid rock – not a passable cell
      });
    }
  }

  // Helper: carve a room by removing interior walls
  function carveRoom(rx, ry, rw, rh, floorColor = '#3a3a2a', wallColor = '#7a6b5a', light = 0.8) {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const cell = map.getCell(x, y);
        if (!cell) continue;
        cell.solid = false; // mark as passable carved space
        cell.floorColor = floorColor;
        cell.wallColor = wallColor;
        cell.light = light;

        // Remove interior walls between room cells
        if (x > rx) {
          cell.setWall(WALL_W, false);
          map.getCell(x - 1, y)?.setWall(WALL_E, false);
        }
        if (y > ry) {
          cell.setWall(WALL_N, false);
          map.getCell(x, y - 1)?.setWall(WALL_S, false);
        }
      }
    }
  }

  // Helper: carve a doorway between two adjacent cells
  function carveDoor(x1, y1, x2, y2) {
    const c1 = map.getCell(x1, y1);
    const c2 = map.getCell(x2, y2);
    if (!c1 || !c2) return;

    if (x2 === x1 + 1) { c1.setWall(WALL_E, false); c2.setWall(WALL_W, false); }
    if (x2 === x1 - 1) { c1.setWall(WALL_W, false); c2.setWall(WALL_E, false); }
    if (y2 === y1 + 1) { c1.setWall(WALL_S, false); c2.setWall(WALL_N, false); }
    if (y2 === y1 - 1) { c1.setWall(WALL_N, false); c2.setWall(WALL_S, false); }
  }

  // --- Rooms ---
  // Entrance hall (top-left)
  carveRoom(1, 1, 4, 3, '#4a4a3a', '#8a7a6a', 1.0);

  // Guard room (top-right)
  carveRoom(8, 1, 3, 3, '#3a3a2a', '#6b5b4b', 0.7);

  // Large central chamber
  carveRoom(5, 5, 6, 5, '#4a3a2a', '#9a8a7a', 0.9);

  // Treasure room (bottom-right)
  carveRoom(12, 10, 3, 3, '#5a4a1a', '#aa9a3a', 1.0);

  // Prison cells (bottom-left)
  carveRoom(1, 10, 2, 2, '#2a2a2a', '#5a5a5a', 0.4);
  carveRoom(1, 13, 2, 2, '#2a2a2a', '#5a5a5a', 0.4);

  // Secret chamber (far bottom-right)
  carveRoom(13, 14, 2, 2, '#3a1a3a', '#7a3a7a', 0.6);

  // --- Corridors ---
  // Corridor from entrance to guard room
  carveRoom(5, 2, 3, 1, '#3a3a3a', '#6b6b6b', 0.5);

  // Corridor from entrance down to central chamber
  carveRoom(3, 4, 1, 1, '#3a3a3a', '#6b6b6b', 0.5);
  carveRoom(3, 5, 2, 1, '#3a3a3a', '#6b6b6b', 0.5);

  // Corridor from guard room down
  carveRoom(9, 4, 1, 1, '#3a3a3a', '#6b6b6b', 0.5);

  // Corridor from central chamber to treasure room
  carveRoom(11, 8, 2, 1, '#3a3a3a', '#6b6b6b', 0.5);
  carveRoom(12, 9, 1, 1, '#3a3a3a', '#6b6b6b', 0.5);

  // Corridor from central chamber down to prison
  carveRoom(5, 10, 1, 2, '#3a3a3a', '#6b6b6b', 0.4);
  carveRoom(3, 11, 2, 1, '#3a3a3a', '#6b6b6b', 0.4);
  carveRoom(3, 10, 1, 1, '#3a3a3a', '#6b6b6b', 0.4);

  // --- Doors connecting corridors to rooms ---
  // Entrance → corridor east
  carveDoor(4, 2, 5, 2);
  // Corridor → guard room
  carveDoor(7, 2, 8, 2);
  // Entrance → corridor south
  carveDoor(3, 3, 3, 4);
  // Corridor → central chamber
  carveDoor(5, 5, 5, 5); // already carved
  // Guard room → corridor south
  carveDoor(9, 3, 9, 4);
  // Corridor → central chamber
  carveDoor(9, 4, 9, 5);
  // Central → treasure corridor
  carveDoor(10, 8, 11, 8);
  carveDoor(12, 8, 12, 9);
  // Central → prison corridor
  carveDoor(5, 9, 5, 10);
  carveDoor(3, 11, 2, 11);
  // Prison corridor → prison cells
  carveDoor(1, 11, 1, 12);
  carveDoor(2, 11, 2, 12);
  // Treasure → secret passage
  carveDoor(13, 12, 13, 13);
  carveDoor(13, 13, 13, 14);

  // Border walls
  map.buildBorderWalls();

  // Add some objects for flavour
  map.getCell(2, 2).objects.push({ type: 'torch', sprite: '🔥', x: 0.5, y: 0.1 });
  map.getCell(9, 2).objects.push({ type: 'chest', sprite: '📦', x: 0.5, y: 0.5 });
  map.getCell(13, 11).objects.push({ type: 'treasure', sprite: '💎', x: 0.5, y: 0.5 });
  map.getCell(1, 13).objects.push({ type: 'skeleton', sprite: '💀', x: 0.5, y: 0.5 });
  map.getCell(13, 14).objects.push({ type: 'altar', sprite: '🗿', x: 0.5, y: 0.5 });

  return map;
}
