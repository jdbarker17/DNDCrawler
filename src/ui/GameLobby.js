/**
 * Game lobby – create or join a game.
 * Shown after login, before the game canvas.
 */

import { getGames, createGame, joinGame } from '../services/api.js';

export class GameLobby {
  /**
   * @param {HTMLElement} container
   * @param {{ id: number, username: string }} user
   * @param {Function} onGameSelected – callback({ id, role }) when a game is entered
   * @param {Function} onLogout – callback when user clicks logout
   */
  constructor(container, user, onGameSelected, onLogout) {
    this.container = container;
    this.user = user;
    this.onGameSelected = onGameSelected;
    this.onLogout = onLogout;
    this.games = [];
    this._build();
    this.refresh();
  }

  _build() {
    this.panel = document.createElement('div');
    this.panel.id = 'game-lobby';
    this.panel.innerHTML = `
      <div class="lobby-header">
        <div class="lobby-logo">D&D Crawler</div>
        <div class="lobby-user">
          <span class="lobby-username">${this.user.username}</span>
          <button class="lobby-logout" id="lobby-logout">Logout</button>
        </div>
      </div>
      <div class="lobby-content">
        <div class="lobby-create">
          <h2>Create New Game</h2>
          <p class="lobby-hint">You will be the Dungeon Master.</p>
          <form class="lobby-create-form" id="lobby-create-form">
            <input type="text" id="lobby-game-name" placeholder="Game name" maxlength="40" required />
            <button type="submit" class="lobby-btn primary">Create Game</button>
          </form>
        </div>
        <div class="lobby-divider"></div>
        <div class="lobby-join">
          <h2>Join a Game</h2>
          <div class="lobby-games-list" id="lobby-games-list">
            <div class="lobby-loading">Loading games...</div>
          </div>
          <button class="lobby-btn secondary" id="lobby-refresh">Refresh</button>
        </div>
      </div>
      <div class="lobby-error" id="lobby-error"></div>
    `;
    this.container.appendChild(this.panel);

    // Create game
    this.panel.querySelector('#lobby-create-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._createGame();
    });

    // Refresh
    this.panel.querySelector('#lobby-refresh').addEventListener('click', () => {
      this.refresh();
    });

    // Logout
    this.panel.querySelector('#lobby-logout').addEventListener('click', () => {
      this.onLogout();
    });
  }

  async refresh() {
    const list = this.panel.querySelector('#lobby-games-list');
    list.innerHTML = '<div class="lobby-loading">Loading games...</div>';

    try {
      this.games = await getGames();
      this._renderGames();
    } catch (err) {
      list.innerHTML = `<div class="lobby-error-inline">Failed to load games</div>`;
    }
  }

  _renderGames() {
    const list = this.panel.querySelector('#lobby-games-list');

    if (this.games.length === 0) {
      list.innerHTML = '<div class="lobby-empty">No games yet. Create one above!</div>';
      return;
    }

    list.innerHTML = '';
    for (const game of this.games) {
      const item = document.createElement('div');
      item.className = 'lobby-game-item';

      const roleLabel = game.my_role
        ? `<span class="lobby-role ${game.my_role}">${game.my_role.toUpperCase()}</span>`
        : '';

      item.innerHTML = `
        <div class="lobby-game-info">
          <div class="lobby-game-name">${game.name} ${roleLabel}</div>
          <div class="lobby-game-meta">DM: ${game.dm_name} · ${game.player_count} player${game.player_count !== 1 ? 's' : ''}</div>
        </div>
        <button class="lobby-btn small">${game.my_role ? 'Enter' : 'Join'}</button>
      `;

      item.querySelector('.lobby-btn').addEventListener('click', () => {
        this._enterGame(game);
      });

      list.appendChild(item);
    }
  }

  async _createGame() {
    const nameInput = this.panel.querySelector('#lobby-game-name');
    const name = nameInput.value.trim();
    if (!name) return;

    this._clearError();

    try {
      const game = await createGame(name);
      nameInput.value = '';
      this.onGameSelected({ id: game.id, role: 'dm' });
    } catch (err) {
      this._showError(err.message);
    }
  }

  async _enterGame(game) {
    this._clearError();

    try {
      if (!game.my_role) {
        // Need to join first
        const result = await joinGame(game.id);
        this.onGameSelected({ id: game.id, role: result.role });
      } else {
        this.onGameSelected({ id: game.id, role: game.my_role });
      }
    } catch (err) {
      this._showError(err.message);
    }
  }

  _showError(msg) {
    this.panel.querySelector('#lobby-error').textContent = msg;
  }

  _clearError() {
    this.panel.querySelector('#lobby-error').textContent = '';
  }

  show() {
    this.panel.style.display = 'flex';
  }

  hide() {
    this.panel.style.display = 'none';
  }

  destroy() {
    this.panel.remove();
  }
}
