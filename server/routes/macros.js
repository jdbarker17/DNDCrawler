/**
 * Dice macro CRUD routes.
 */

import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../auth.js';

const router = Router();

// All macro routes require authentication
router.use(authenticateToken);

/**
 * GET /api/characters/:charId/macros
 * List all macros for a character. Owner or DM only.
 */
router.get('/characters/:charId/macros', (req, res) => {
  const charId = parseInt(req.params.charId, 10);

  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }

  // Check authorization: must be owner or DM
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(character.game_id);
  const isOwner = character.user_id === req.user.id;
  const isDM = game && game.dm_user_id === req.user.id;

  if (!isOwner && !isDM) {
    return res.status(403).json({ error: 'Not authorized to view macros for this character' });
  }

  const macros = db.prepare(
    'SELECT * FROM dice_macros WHERE character_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(charId);

  res.json({ macros });
});

/**
 * POST /api/characters/:charId/macros
 * Create a macro for a character. Owner or DM only.
 * Body: { name, formula, description?, category? }
 */
router.post('/characters/:charId/macros', (req, res) => {
  const charId = parseInt(req.params.charId, 10);

  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }

  // Check authorization: must be owner or DM
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(character.game_id);
  const isOwner = character.user_id === req.user.id;
  const isDM = game && game.dm_user_id === req.user.id;

  if (!isOwner && !isDM) {
    return res.status(403).json({ error: 'Not authorized to create macros for this character' });
  }

  const { name, formula, description, category } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Macro name is required' });
  }
  if (!formula || !formula.trim()) {
    return res.status(400).json({ error: 'Macro formula is required' });
  }

  const validCategories = ['attack', 'ability', 'save', 'skill', 'spell', 'custom'];
  const cat = validCategories.includes(category) ? category : 'custom';

  // Get next sort_order
  const maxOrder = db.prepare(
    'SELECT MAX(sort_order) as max_order FROM dice_macros WHERE character_id = ?'
  ).get(charId);
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  const result = db.prepare(`
    INSERT INTO dice_macros (character_id, game_id, user_id, name, formula, description, category, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    charId,
    character.game_id,
    req.user.id,
    name.trim(),
    formula.trim(),
    description || '',
    cat,
    sortOrder
  );

  const macro = db.prepare('SELECT * FROM dice_macros WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(macro);
});

/**
 * PUT /api/macros/:id
 * Update a macro. Owner or DM only.
 * Body: { name?, formula?, description?, category? }
 */
router.put('/macros/:id', (req, res) => {
  const macroId = parseInt(req.params.id, 10);

  const macro = db.prepare('SELECT * FROM dice_macros WHERE id = ?').get(macroId);
  if (!macro) {
    return res.status(404).json({ error: 'Macro not found' });
  }

  // Check authorization: must be owner or DM
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(macro.game_id);
  const isOwner = macro.user_id === req.user.id;
  const isDM = game && game.dm_user_id === req.user.id;

  if (!isOwner && !isDM) {
    return res.status(403).json({ error: 'Not authorized to update this macro' });
  }

  const { name, formula, description, category } = req.body;

  const validCategories = ['attack', 'ability', 'save', 'skill', 'spell', 'custom'];
  const cat = category !== undefined ? (validCategories.includes(category) ? category : 'custom') : null;

  db.prepare(`
    UPDATE dice_macros SET
      name = COALESCE(?, name),
      formula = COALESCE(?, formula),
      description = COALESCE(?, description),
      category = COALESCE(?, category)
    WHERE id = ?
  `).run(
    name ? name.trim() : null,
    formula ? formula.trim() : null,
    description !== undefined ? description : null,
    cat,
    macroId
  );

  const updated = db.prepare('SELECT * FROM dice_macros WHERE id = ?').get(macroId);
  res.json(updated);
});

/**
 * DELETE /api/macros/:id
 * Delete a macro. Owner or DM only.
 */
router.delete('/macros/:id', (req, res) => {
  const macroId = parseInt(req.params.id, 10);

  const macro = db.prepare('SELECT * FROM dice_macros WHERE id = ?').get(macroId);
  if (!macro) {
    return res.status(404).json({ error: 'Macro not found' });
  }

  // Check authorization: must be owner or DM
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(macro.game_id);
  const isOwner = macro.user_id === req.user.id;
  const isDM = game && game.dm_user_id === req.user.id;

  if (!isOwner && !isDM) {
    return res.status(403).json({ error: 'Not authorized to delete this macro' });
  }

  db.prepare('DELETE FROM dice_macros WHERE id = ?').run(macroId);
  res.json({ success: true });
});

export default router;
