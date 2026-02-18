/**
 * Player roster panel – lists all players, lets you select/control one,
 * add new characters, and remove them.
 * Now supports ownership: players can only control their own characters,
 * while the DM can control any character.
 */

import { Player } from '../engine/Player.js';
import { createCharacter, deleteCharacter } from '../services/api.js';
import { sendCharacterAdded, sendCharacterRemoved } from '../services/socket.js';

const PRESET_CHARACTERS = [
  { name: 'Thorin', className: 'Fighter', color: '#e74c3c', token: '\u{1F6E1}\uFE0F' },
  { name: 'Elara', className: 'Wizard', color: '#9b59b6', token: '\u{1FA84}' },
  { name: 'Finn', className: 'Rogue', color: '#2ecc71', token: '\u{1F5E1}\uFE0F' },
  { name: 'Sera', className: 'Cleric', color: '#f1c40f', token: '\u2728' },
  { name: 'Brok', className: 'Barbarian', color: '#e67e22', token: '\u{1FA93}' },
  { name: 'Lyra', className: 'Ranger', color: '#1abc9c', token: '\u{1F3F9}' },
];

export class PlayerRoster {
  /**
   * @param {HTMLElement} container – DOM element to mount into
   * @param {Function} onSelect – callback(player) when active player changes
   * @param {Function} onPlayersChange – callback(players[]) when roster changes
   * @param {{ id: number, username: string }} currentUser
   * @param {string} role – 'dm' | 'player'
   * @param {number} gameId – current game ID for API calls
   */
  constructor(container, onSelect, onPlayersChange, currentUser, role, gameId) {
    this.container = container;
    this.onSelect = onSelect;
    this.onPlayersChange = onPlayersChange;
    this.currentUser = currentUser;
    this.role = role;
    this.gameId = gameId;
    this.players = [];
    this.activePlayer = null;

    this._buildUI();
  }

  /** Check if current user can control a player. */
  _canControl(player) {
    if (!player) return false;
    if (this.role === 'dm') return true;
    return player.ownerId === this.currentUser.id;
  }

  _buildUI() {
    this.panel = document.createElement('div');
    this.panel.id = 'player-roster';
    this.panel.innerHTML = `
      <div class="roster-title">Party</div>
      <div class="roster-user-info">
        <span class="roster-role-badge ${this.role}">${this.role.toUpperCase()}</span>
        <span class="roster-user-name">${this.currentUser.username}</span>
      </div>
      <div class="roster-list" id="roster-list"></div>
      <button class="roster-add-btn" id="roster-add-btn">+ Add Character</button>
      <div class="roster-add-form" id="roster-add-form" style="display:none">
        <input type="text" id="new-player-name" placeholder="Character name" maxlength="20" />
        <input type="text" id="new-player-class" placeholder="Class (optional)" maxlength="20" />
        <div class="roster-color-row">
          <label>Color</label>
          <input type="color" id="new-player-color" value="#3498db" />
        </div>
        <div class="roster-presets" id="roster-presets">
          <span class="roster-presets-label">Quick-add:</span>
        </div>
        <div class="roster-form-actions">
          <button class="roster-btn confirm" id="roster-confirm-add">Add</button>
          <button class="roster-btn cancel" id="roster-cancel-add">Cancel</button>
        </div>
      </div>
    `;
    this.container.appendChild(this.panel);

    // Preset buttons
    const presetsContainer = this.panel.querySelector('#roster-presets');
    for (const preset of PRESET_CHARACTERS) {
      const btn = document.createElement('button');
      btn.className = 'roster-preset-btn';
      btn.textContent = `${preset.token} ${preset.name}`;
      btn.style.borderColor = preset.color;
      btn.addEventListener('click', () => this._addPreset(preset));
      presetsContainer.appendChild(btn);
    }

    // Toggle add form
    this.panel.querySelector('#roster-add-btn').addEventListener('click', () => {
      const form = this.panel.querySelector('#roster-add-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    // Confirm add
    this.panel.querySelector('#roster-confirm-add').addEventListener('click', () => {
      this._addCustomPlayer();
    });

    // Cancel add
    this.panel.querySelector('#roster-cancel-add').addEventListener('click', () => {
      this.panel.querySelector('#roster-add-form').style.display = 'none';
    });

    // Enter key to confirm
    this.panel.querySelector('#new-player-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._addCustomPlayer();
    });
  }

  async _addPreset(preset) {
    const spawn = this._findSpawnPoint();

    try {
      // Save to server
      const serverChar = await createCharacter(this.gameId, {
        name: preset.name,
        class_name: preset.className,
        color: preset.color,
        token: preset.token,
        x: spawn.x,
        y: spawn.y,
        angle: 0,
      });

      // Create local player from server data
      const player = Player.fromServerData(serverChar);
      this.addPlayer(player, true);

      // Broadcast to other connected clients
      sendCharacterAdded(serverChar);

      this.panel.querySelector('#roster-add-form').style.display = 'none';
    } catch (err) {
      console.error('Failed to add preset character:', err);
    }
  }

  async _addCustomPlayer() {
    const nameInput = this.panel.querySelector('#new-player-name');
    const classInput = this.panel.querySelector('#new-player-class');
    const colorInput = this.panel.querySelector('#new-player-color');

    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }

    const spawn = this._findSpawnPoint();

    try {
      // Save to server
      const serverChar = await createCharacter(this.gameId, {
        name,
        class_name: classInput.value.trim(),
        color: colorInput.value,
        token: '\u{1F9D1}',
        x: spawn.x,
        y: spawn.y,
        angle: 0,
      });

      // Create local player from server data
      const player = Player.fromServerData(serverChar);
      this.addPlayer(player, true);

      // Broadcast to other connected clients
      sendCharacterAdded(serverChar);

      // Reset form
      nameInput.value = '';
      classInput.value = '';
      this.panel.querySelector('#roster-add-form').style.display = 'none';
    } catch (err) {
      console.error('Failed to add character:', err);
    }
  }

  _findSpawnPoint() {
    // Stagger spawn positions in the entrance hall area
    const baseX = 2.5;
    const baseY = 2.5;
    const offset = this.players.length * 0.6;
    return {
      x: baseX + (offset % 3),
      y: baseY + Math.floor(offset / 3) * 0.6,
    };
  }

  /**
   * Add a player to the roster.
   * @param {Player} player
   * @param {boolean} skipCreate – true if already saved to server
   */
  addPlayer(player, skipCreate = false) {
    this.players.push(player);
    if (!this.activePlayer && this._canControl(player)) {
      this.activePlayer = player;
      this.onSelect(player);
    }
    this.onPlayersChange(this.players);
    this._renderList();
  }

  async removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;

    const removed = this.players[idx];

    // Check permission
    if (!this._canControl(removed)) return;

    // Delete from server
    if (removed.characterId) {
      try {
        await deleteCharacter(removed.characterId);
        // Broadcast removal to other connected clients
        sendCharacterRemoved(removed.characterId);
      } catch (err) {
        console.error('Failed to delete character:', err);
        return;
      }
    }

    this.players.splice(idx, 1);

    // If we removed the active player, select the next one we can control
    if (this.activePlayer === removed) {
      this.activePlayer = this.players.find(p => this._canControl(p)) || null;
      this.onSelect(this.activePlayer);
    }

    this.onPlayersChange(this.players);
    this._renderList();
  }

  selectPlayer(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // Only allow selecting controllable characters
    if (this._canControl(player)) {
      this.activePlayer = player;
      this.onSelect(player);
      this._renderList();
    }
  }

  _renderList() {
    const list = this.panel.querySelector('#roster-list');
    list.innerHTML = '';

    for (const player of this.players) {
      const isActive = player === this.activePlayer;
      const isOwn = player.ownerId === this.currentUser.id;
      const canCtrl = this._canControl(player);
      const item = document.createElement('div');
      item.className = `roster-item${isActive ? ' active' : ''}${!canCtrl ? ' locked' : ''}`;
      item.innerHTML = `
        <div class="roster-item-token" style="background:${player.color}">${player.token}</div>
        <div class="roster-item-info">
          <div class="roster-item-name">${player.name}${isOwn ? ' <span class="roster-you">(you)</span>' : ''}</div>
          <div class="roster-item-class">${player.className || 'Adventurer'}</div>
        </div>
        <div class="roster-item-pos">(${Math.floor(player.x)},${Math.floor(player.y)})</div>
        ${canCtrl ? `<button class="roster-item-remove" data-id="${player.id}" title="Remove">\u00D7</button>` : ''}
      `;

      // Click to select (only if controllable)
      item.addEventListener('click', (e) => {
        if (e.target.closest('.roster-item-remove')) return;
        if (canCtrl) {
          this.selectPlayer(player.id);
        }
      });

      // Remove button (only shown for controllable characters)
      const removeBtn = item.querySelector('.roster-item-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          this.removePlayer(player.id);
        });
      }

      list.appendChild(item);
    }
  }

  /** Call periodically to update position display. */
  refreshPositions() {
    const playerNodes = this.panel.querySelectorAll('.roster-item');
    playerNodes.forEach((node, i) => {
      if (this.players[i]) {
        const p = this.players[i];
        const posEl = node.querySelector('.roster-item-pos');
        if (posEl) posEl.textContent = `(${Math.floor(p.x)},${Math.floor(p.y)})`;
      }
    });
  }
}
