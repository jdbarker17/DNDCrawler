/**
 * Player roster panel – lists all players, lets you select/control one,
 * add new characters, and remove them.
 */

import { Player } from '../engine/Player.js';

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
   */
  constructor(container, onSelect, onPlayersChange) {
    this.container = container;
    this.onSelect = onSelect;
    this.onPlayersChange = onPlayersChange;
    this.players = [];
    this.activePlayer = null;

    this._buildUI();
  }

  _buildUI() {
    this.panel = document.createElement('div');
    this.panel.id = 'player-roster';
    this.panel.innerHTML = `
      <div class="roster-title">Party</div>
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

  _addPreset(preset) {
    // Find a spawn point that doesn't overlap existing players
    const spawn = this._findSpawnPoint();
    const player = new Player(spawn.x, spawn.y, 0);
    player.name = preset.name;
    player.className = preset.className;
    player.color = preset.color;
    player.token = preset.token;
    this.addPlayer(player);

    this.panel.querySelector('#roster-add-form').style.display = 'none';
  }

  _addCustomPlayer() {
    const nameInput = this.panel.querySelector('#new-player-name');
    const classInput = this.panel.querySelector('#new-player-class');
    const colorInput = this.panel.querySelector('#new-player-color');

    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }

    const spawn = this._findSpawnPoint();
    const player = new Player(spawn.x, spawn.y, 0);
    player.name = name;
    player.className = classInput.value.trim();
    player.color = colorInput.value;
    player.token = '\u{1F9D1}';
    this.addPlayer(player);

    // Reset form
    nameInput.value = '';
    classInput.value = '';
    this.panel.querySelector('#roster-add-form').style.display = 'none';
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

  addPlayer(player) {
    this.players.push(player);
    if (!this.activePlayer) {
      this.activePlayer = player;
      this.onSelect(player);
    }
    this.onPlayersChange(this.players);
    this._renderList();
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;

    const removed = this.players.splice(idx, 1)[0];

    // If we removed the active player, select the next one
    if (this.activePlayer === removed) {
      this.activePlayer = this.players[0] || null;
      this.onSelect(this.activePlayer);
    }

    this.onPlayersChange(this.players);
    this._renderList();
  }

  selectPlayer(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;
    this.activePlayer = player;
    this.onSelect(player);
    this._renderList();
  }

  _renderList() {
    const list = this.panel.querySelector('#roster-list');
    list.innerHTML = '';

    for (const player of this.players) {
      const isActive = player === this.activePlayer;
      const item = document.createElement('div');
      item.className = `roster-item${isActive ? ' active' : ''}`;
      item.innerHTML = `
        <div class="roster-item-token" style="background:${player.color}">${player.token}</div>
        <div class="roster-item-info">
          <div class="roster-item-name">${player.name}</div>
          <div class="roster-item-class">${player.className || 'Adventurer'}</div>
        </div>
        <div class="roster-item-pos">(${Math.floor(player.x)},${Math.floor(player.y)})</div>
        <button class="roster-item-remove" data-id="${player.id}" title="Remove">\u00D7</button>
      `;

      // Click to select
      item.addEventListener('click', (e) => {
        if (e.target.closest('.roster-item-remove')) return;
        this.selectPlayer(player.id);
      });

      // Remove button
      item.querySelector('.roster-item-remove').addEventListener('click', () => {
        this.removePlayer(player.id);
      });

      list.appendChild(item);
    }
  }

  /** Call periodically to update position display. */
  refreshPositions() {
    const items = this.panel.querySelectorAll('.roster-item-pos');
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
