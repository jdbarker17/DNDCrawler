/**
 * Character CRUD routes.
 */

import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../auth.js';

const router = Router();

// All character routes require authentication
router.use(authenticateToken);

/**
 * POST /api/games/:gameId/characters
 * Create a character in a game.
 * Body: { name, class_name, color, token, x, y, angle, speed }
 */
router.post('/games/:gameId/characters', (req, res) => {
  const gameId = parseInt(req.params.gameId, 10);

  // Check game exists
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  // Check membership
  const membership = db.prepare(
    'SELECT role FROM game_players WHERE game_id = ? AND user_id = ?'
  ).get(gameId, req.user.id);

  if (!membership) {
    return res.status(403).json({ error: 'You are not a member of this game' });
  }

  const { name, class_name, color, token, x, y, angle, speed, is_monster, hp, max_hp, monster_image, creature_type, size } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Character name is required' });
  }

  // Only the DM can create monsters
  if (is_monster) {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    if (!game || game.dm_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the DM can add monsters' });
    }
  }

  const result = db.prepare(`
    INSERT INTO characters (user_id, game_id, name, class_name, color, token, x, y, angle, speed, is_monster, hp, max_hp, monster_image, creature_type, size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    gameId,
    name.trim(),
    class_name || '',
    color || '#e74c3c',
    token || '',
    x ?? 2.5,
    y ?? 1.5,
    angle ?? 0,
    speed ?? 30,
    is_monster ? 1 : 0,
    hp ?? null,
    max_hp ?? null,
    monster_image || null,
    creature_type || 'humanoid',
    size || 'medium'
  );

  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json(character);
});

/**
 * PUT /api/characters/:id
 * Update a character's position/state.
 * Only the character's owner or the game's DM can update.
 */
router.put('/characters/:id', (req, res) => {
  const charId = parseInt(req.params.id, 10);

  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }

  // Check authorization: must be owner or DM
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(character.game_id);
  const isOwner = character.user_id === req.user.id;
  const isDM = game && game.dm_user_id === req.user.id;

  if (!isOwner && !isDM) {
    return res.status(403).json({ error: 'Not authorized to update this character' });
  }

  const { name, class_name, color, token, x, y, angle, speed, hp, max_hp, monster_image, creature_type, size } = req.body;

  db.prepare(`
    UPDATE characters SET
      name = COALESCE(?, name),
      class_name = COALESCE(?, class_name),
      color = COALESCE(?, color),
      token = COALESCE(?, token),
      x = COALESCE(?, x),
      y = COALESCE(?, y),
      angle = COALESCE(?, angle),
      speed = COALESCE(?, speed),
      hp = COALESCE(?, hp),
      max_hp = COALESCE(?, max_hp),
      monster_image = COALESCE(?, monster_image),
      creature_type = COALESCE(?, creature_type),
      size = COALESCE(?, size)
    WHERE id = ?
  `).run(
    name ?? null,
    class_name ?? null,
    color ?? null,
    token ?? null,
    x ?? null,
    y ?? null,
    angle ?? null,
    speed ?? null,
    hp ?? null,
    max_hp ?? null,
    monster_image ?? null,
    creature_type ?? null,
    size ?? null,
    charId
  );

  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  res.json(updated);
});

/**
 * DELETE /api/characters/:id
 * Remove a character. Only the owner or DM can delete.
 */
router.delete('/characters/:id', (req, res) => {
  const charId = parseInt(req.params.id, 10);

  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(character.game_id);
  const isOwner = character.user_id === req.user.id;
  const isDM = game && game.dm_user_id === req.user.id;

  if (!isOwner && !isDM) {
    return res.status(403).json({ error: 'Not authorized to delete this character' });
  }

  db.prepare('DELETE FROM characters WHERE id = ?').run(charId);
  res.json({ success: true });
});

export default router;
