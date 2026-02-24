/**
 * Saved map library routes: CRUD for user-owned maps.
 * Maps belong to a user (not a game) and can be loaded into any game.
 */

import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../auth.js';

const router = Router();

// All map routes require authentication
router.use(authenticateToken);

/**
 * GET /api/maps
 * List all saved maps for the current user (metadata only, no map_data).
 */
router.get('/', (req, res) => {
  const maps = db.prepare(`
    SELECT id, name, width, height, created_at, updated_at
    FROM saved_maps
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(req.user.id);

  res.json(maps);
});

/**
 * POST /api/maps
 * Save a new map to the library.
 * Body: { name, map_data }
 */
router.post('/', (req, res) => {
  const { name, map_data } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Map name is required' });
  }
  if (!map_data) {
    return res.status(400).json({ error: 'Map data is required' });
  }

  const width = map_data.width || 0;
  const height = map_data.height || 0;

  const result = db.prepare(
    'INSERT INTO saved_maps (user_id, name, width, height, map_data) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, name.trim(), width, height, JSON.stringify(map_data));

  res.status(201).json({
    id: result.lastInsertRowid,
    name: name.trim(),
    width,
    height,
  });
});

/**
 * GET /api/maps/:id
 * Get a single saved map with full data.
 */
router.get('/:id', (req, res) => {
  const map = db.prepare(
    'SELECT * FROM saved_maps WHERE id = ? AND user_id = ?'
  ).get(parseInt(req.params.id, 10), req.user.id);

  if (!map) {
    return res.status(404).json({ error: 'Map not found' });
  }

  res.json({
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    map_data: JSON.parse(map.map_data),
    created_at: map.created_at,
    updated_at: map.updated_at,
  });
});

/**
 * PUT /api/maps/:id
 * Update a saved map (name and/or data).
 * Body: { name?, map_data? }
 */
router.put('/:id', (req, res) => {
  const mapId = parseInt(req.params.id, 10);
  const { name, map_data } = req.body;

  const existing = db.prepare(
    'SELECT id FROM saved_maps WHERE id = ? AND user_id = ?'
  ).get(mapId, req.user.id);

  if (!existing) {
    return res.status(404).json({ error: 'Map not found' });
  }

  const updates = [];
  const params = [];

  if (name && name.trim()) {
    updates.push('name = ?');
    params.push(name.trim());
  }
  if (map_data) {
    updates.push('map_data = ?');
    params.push(JSON.stringify(map_data));
    updates.push('width = ?');
    params.push(map_data.width || 0);
    updates.push('height = ?');
    params.push(map_data.height || 0);
  }
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(mapId);

  db.prepare(`UPDATE saved_maps SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ success: true });
});

/**
 * DELETE /api/maps/:id
 * Delete a saved map.
 */
router.delete('/:id', (req, res) => {
  const mapId = parseInt(req.params.id, 10);
  const result = db.prepare(
    'DELETE FROM saved_maps WHERE id = ? AND user_id = ?'
  ).run(mapId, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Map not found' });
  }

  res.json({ success: true });
});

export default router;
