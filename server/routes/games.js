/**
 * Game management routes: create, list, join, get state.
 */

import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../auth.js';

const router = Router();

// All game routes require authentication
router.use(authenticateToken);

/**
 * POST /api/games
 * Body: { name }
 * Creates a new game with the current user as DM.
 */
router.post('/', (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Game name is required' });
  }

  const result = db.prepare(
    'INSERT INTO games (name, dm_user_id) VALUES (?, ?)'
  ).run(name.trim(), req.user.id);

  const gameId = result.lastInsertRowid;

  // Auto-join the DM as a player with role 'dm'
  db.prepare(
    'INSERT INTO game_players (game_id, user_id, role) VALUES (?, ?, ?)'
  ).run(gameId, req.user.id, 'dm');

  res.status(201).json({
    id: gameId,
    name: name.trim(),
    dm_user_id: req.user.id,
    role: 'dm',
  });
});

/**
 * GET /api/games
 * List all games with DM name and player count.
 */
router.get('/', (req, res) => {
  const games = db.prepare(`
    SELECT
      g.id,
      g.name,
      g.dm_user_id,
      u.username AS dm_name,
      g.created_at,
      (SELECT COUNT(*) FROM game_players WHERE game_id = g.id) AS player_count,
      (SELECT role FROM game_players WHERE game_id = g.id AND user_id = ?) AS my_role
    FROM games g
    JOIN users u ON u.id = g.dm_user_id
    ORDER BY g.created_at DESC
  `).all(req.user.id);

  res.json(games);
});

/**
 * POST /api/games/:id/join
 * Join a game as a player.
 */
router.post('/:id/join', (req, res) => {
  const gameId = parseInt(req.params.id, 10);

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  // Check if already joined
  const existing = db.prepare(
    'SELECT * FROM game_players WHERE game_id = ? AND user_id = ?'
  ).get(gameId, req.user.id);

  if (existing) {
    return res.json({ id: gameId, role: existing.role, message: 'Already joined' });
  }

  // Join as player
  db.prepare(
    'INSERT INTO game_players (game_id, user_id, role) VALUES (?, ?, ?)'
  ).run(gameId, req.user.id, 'player');

  res.json({ id: gameId, role: 'player' });
});

/**
 * GET /api/games/:id
 * Get full game state: game info, map data, characters, and the user's role.
 */
router.get('/:id', (req, res) => {
  const gameId = parseInt(req.params.id, 10);

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

  // Get all characters for this game
  const characters = db.prepare(`
    SELECT c.*, u.username AS owner_name
    FROM characters c
    JOIN users u ON u.id = c.user_id
    WHERE c.game_id = ?
  `).all(gameId);

  // Get all players in the game
  const players = db.prepare(`
    SELECT gp.user_id, gp.role, u.username
    FROM game_players gp
    JOIN users u ON u.id = gp.user_id
    WHERE gp.game_id = ?
  `).all(gameId);

  res.json({
    id: game.id,
    name: game.name,
    dm_user_id: game.dm_user_id,
    map_data: game.map_data ? JSON.parse(game.map_data) : null,
    my_role: membership.role,
    characters,
    players,
  });
});

/**
 * PUT /api/games/:id/map
 * Save map data (DM only).
 */
router.put('/:id/map', (req, res) => {
  const gameId = parseInt(req.params.id, 10);

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.dm_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the DM can save the map' });
  }

  const { map_data } = req.body;
  db.prepare('UPDATE games SET map_data = ? WHERE id = ?').run(
    JSON.stringify(map_data),
    gameId
  );

  res.json({ success: true });
});

export default router;
