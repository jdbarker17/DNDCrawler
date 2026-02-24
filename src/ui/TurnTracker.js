/**
 * Turn Tracker UI component.
 * DM-only panel for managing initiative order and advancing turns.
 * Players see a read-only view of whose turn it is.
 * Players can submit initiative rolls for their own characters;
 * DM can edit any roll and sort the order by initiative.
 */

export class TurnTracker {
  /**
   * @param {HTMLElement} container – DOM element to mount into
   * @param {import('../engine/Player.js').Player[]} players
   * @param {{ id: number, username: string }} currentUser
   * @param {string} role – 'dm' | 'player'
   * @param {(turnState: object) => void} onTurnChange – called when DM changes turn state
   * @param {(characterId: number, roll: number|null) => void} [onInitiativeRoll] – called when a roll is submitted
   * @param {(sortedCharIds: number[]) => void} [onInitiativeSort] – called when DM sorts initiative order
   */
  constructor(container, players, currentUser, role, onTurnChange, onInitiativeRoll = null, onInitiativeSort = null) {
    this.container = container;
    this.players = [...players];
    this.currentUser = currentUser;
    this.role = role;
    this.onTurnChange = onTurnChange;
    this.onInitiativeRoll = onInitiativeRoll;
    this.onInitiativeSort = onInitiativeSort;

    // Turn state
    this.enabled = false;
    this.order = [];           // characterId[]
    this.activeIndex = -1;
    this.turnCounter = 0;

    // Initiative rolls: Map<characterId, number|null>
    this.initiativeRolls = new Map();

    // Drag reorder state
    this._dragSrcIndex = null;

    this._build();
  }

  _build() {
    this.el = document.createElement('div');
    this.el.id = 'turn-tracker';
    this.el.style.display = 'none'; // hidden until Action Mode enabled
    this.container.appendChild(this.el);
    this._render();
  }

  _render() {
    const isDM = this.role === 'dm';

    let html = `<div class="turn-tracker-title">Initiative Order</div>`;

    if (isDM && this.enabled) {
      html += `<div class="turn-controls">`;
      html += `<button class="turn-btn prev-turn" ${this.activeIndex <= 0 ? 'disabled' : ''}>Prev</button>`;
      html += `<span class="turn-counter">Turn ${this.turnCounter + 1}</span>`;
      html += `<button class="turn-btn next-turn">Next</button>`;
      html += `</div>`;
    }

    // Active turn banner for players
    if (!isDM && this.enabled && this.activeIndex >= 0 && this.order.length > 0) {
      const activeCharId = this.order[this.activeIndex];
      const activePlayer = this.players.find(p => p.characterId === activeCharId);
      const isMyTurn = activePlayer && activePlayer.ownerId === this.currentUser.id;
      if (isMyTurn) {
        html += `<div class="turn-your-turn">Your Turn!</div>`;
      }
    }

    // Initiative roll header hint
    if (this.enabled && this.order.length === 0) {
      html += `<div class="initiative-hint">Enter your initiative rolls below</div>`;
    }

    html += `<div class="turn-order-list">`;

    if (this.order.length === 0) {
      // Not started yet — show all players for ordering with initiative inputs
      const list = this.players;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        html += this._renderItem(p, i, false, isDM);
      }
    } else {
      // Show ordered list
      for (let i = 0; i < this.order.length; i++) {
        const charId = this.order[i];
        const p = this.players.find(pl => pl.characterId === charId);
        if (!p) continue;
        const isActive = i === this.activeIndex;
        html += this._renderItem(p, i, isActive, isDM);
      }
    }

    html += `</div>`;

    // DM action buttons
    if (isDM && this.enabled) {
      if (this.order.length === 0) {
        // Pre-start: sort + start buttons
        const hasAnyRolls = this._hasAnyRolls();
        html += `<div class="turn-action-row">`;
        html += `<button class="turn-btn sort-initiative" ${hasAnyRolls ? '' : 'disabled'} title="Sort characters by initiative roll (highest first)">Sort by Initiative</button>`;
        html += `</div>`;
        html += `<button class="turn-btn start-turns">Start Turns</button>`;
      } else {
        html += `<button class="turn-btn end-turns">End Action Mode</button>`;
      }
    }

    this.el.innerHTML = html;
    this._attachEvents();
  }

  _renderItem(player, index, isActive, isDM) {
    const activeClass = isActive ? ' active-turn' : '';
    const draggable = isDM && this.enabled ? 'draggable="true"' : '';
    const dragHandle = isDM && this.enabled ? '<span class="turn-drag-handle">:::</span>' : '';
    const isMyChar = player.ownerId === this.currentUser.id;
    const youBadge = isMyChar ? ' <span class="turn-you">(you)</span>' : '';
    const orderNum = index + 1;

    // Initiative roll value
    const roll = this.initiativeRolls.get(player.characterId);
    const rollValue = roll != null ? roll : '';

    // Can this user edit this character's initiative?
    // Players can edit their own before turns start; DM can edit any before turns start
    const turnsStarted = this.order.length > 0;
    const canEditRoll = !turnsStarted && (isDM || isMyChar);

    // Initiative input or display
    let initiativeHtml;
    if (canEditRoll) {
      initiativeHtml = `<input type="number" class="initiative-input" data-char-id="${player.characterId}" value="${rollValue}" placeholder="—" title="Initiative roll" min="1" max="30" />`;
    } else {
      // Read-only display
      const displayVal = rollValue !== '' ? rollValue : '—';
      initiativeHtml = `<span class="initiative-display" title="Initiative roll">${displayVal}</span>`;
    }

    return `
      <div class="turn-order-item${activeClass}" data-index="${index}" data-char-id="${player.characterId}" ${draggable}>
        ${dragHandle}
        <span class="turn-order-num">${orderNum}</span>
        <span class="turn-order-token" style="background:${player.color}"></span>
        <span class="turn-order-name">${player.name}${youBadge}</span>
        ${initiativeHtml}
      </div>
    `;
  }

  _attachEvents() {
    const isDM = this.role === 'dm';

    // Next/Prev turn buttons
    const nextBtn = this.el.querySelector('.next-turn');
    const prevBtn = this.el.querySelector('.prev-turn');
    const startBtn = this.el.querySelector('.start-turns');
    const endBtn = this.el.querySelector('.end-turns');
    const sortBtn = this.el.querySelector('.sort-initiative');

    if (nextBtn) {
      nextBtn.addEventListener('click', () => this._advanceTurn(1));
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this._advanceTurn(-1));
    }
    if (startBtn) {
      startBtn.addEventListener('click', () => this._startTurns());
    }
    if (endBtn) {
      endBtn.addEventListener('click', () => this._endActionMode());
    }
    if (sortBtn) {
      sortBtn.addEventListener('click', () => this._sortByInitiative());
    }

    // Initiative roll inputs
    const inputs = this.el.querySelectorAll('.initiative-input');
    inputs.forEach(input => {
      // Submit on change (blur or Enter)
      const handleSubmit = () => {
        const charId = parseInt(input.dataset.charId, 10);
        const raw = input.value.trim();
        const roll = raw === '' ? null : parseInt(raw, 10);
        if (roll !== null && isNaN(roll)) return;

        this.initiativeRolls.set(charId, roll);

        // Notify main.js to broadcast via WebSocket
        if (this.onInitiativeRoll) {
          this.onInitiativeRoll(charId, roll);
        }

        // Re-render to update sort button state
        this._render();
      };

      input.addEventListener('change', handleSubmit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    // Drag reorder (DM only)
    if (isDM && this.enabled) {
      const items = this.el.querySelectorAll('.turn-order-item');
      items.forEach((item, idx) => {
        item.addEventListener('dragstart', (e) => {
          this._dragSrcIndex = idx;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', idx.toString());
          item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          this.el.querySelectorAll('.turn-order-item').forEach(el => {
            el.classList.remove('drag-over');
          });
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          item.classList.add('drag-over');
        });

        item.addEventListener('dragleave', () => {
          item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
          e.preventDefault();
          item.classList.remove('drag-over');
          const fromIdx = this._dragSrcIndex;
          const toIdx = idx;
          if (fromIdx === null || fromIdx === toIdx) return;
          this._reorder(fromIdx, toIdx);
        });
      });
    }
  }

  /** Check if any character has submitted an initiative roll. */
  _hasAnyRolls() {
    for (const [, roll] of this.initiativeRolls) {
      if (roll != null) return true;
    }
    return false;
  }

  /** Sort the player list by initiative roll (highest first). DM only. */
  _sortByInitiative() {
    this.players.sort((a, b) => {
      const rollA = this.initiativeRolls.get(a.characterId) ?? -1;
      const rollB = this.initiativeRolls.get(b.characterId) ?? -1;
      return rollB - rollA; // descending
    });
    this._render();

    // Broadcast sorted order to all clients via both mechanisms
    const sortedCharIds = this.players
      .filter(p => p.characterId)
      .map(p => p.characterId);

    if (this.onInitiativeSort) {
      this.onInitiativeSort(sortedCharIds);
    }

    // Also emit a turn_update with the sorted player order so all clients
    // update immediately (the turn_update path is proven to work reliably)
    this.onTurnChange({
      enabled: true,
      order: [],
      activeIndex: -1,
      sortedPlayerOrder: sortedCharIds,
    });
  }

  _startTurns() {
    // Build order from current player list order (which may have been sorted)
    this.order = this.players
      .filter(p => p.characterId)
      .map(p => p.characterId);
    this.activeIndex = 0;
    this.turnCounter = 0;
    this._emitChange();
    this._render();
  }

  _advanceTurn(direction) {
    if (this.order.length === 0) return;

    let newIndex = this.activeIndex + direction;
    if (newIndex >= this.order.length) {
      // Wrap to beginning, increment turn counter
      newIndex = 0;
      this.turnCounter++;
    } else if (newIndex < 0) {
      // Wrap to end, decrement turn counter
      if (this.turnCounter > 0) {
        this.turnCounter--;
        newIndex = this.order.length - 1;
      } else {
        newIndex = 0;
      }
    }

    this.activeIndex = newIndex;
    this._emitChange();
    this._render();
  }

  _reorder(fromIdx, toIdx) {
    // If turns haven't started, reorder in the players display list
    if (this.order.length === 0) {
      const moved = this.players.splice(fromIdx, 1)[0];
      this.players.splice(toIdx, 0, moved);
    } else {
      // Reorder the active order
      const moved = this.order.splice(fromIdx, 1)[0];
      this.order.splice(toIdx, 0, moved);

      // Adjust activeIndex if needed
      if (fromIdx === this.activeIndex) {
        this.activeIndex = toIdx;
      } else if (fromIdx < this.activeIndex && toIdx >= this.activeIndex) {
        this.activeIndex--;
      } else if (fromIdx > this.activeIndex && toIdx <= this.activeIndex) {
        this.activeIndex++;
      }

      this._emitChange();
    }
    this._render();
  }

  _endActionMode() {
    this.order = [];
    this.activeIndex = -1;
    this.turnCounter = 0;
    // Emit disabled state — DMTools will handle toggling off
    this.onTurnChange({ enabled: false, order: [], activeIndex: -1 });
  }

  _emitChange() {
    this.onTurnChange({
      enabled: true,
      order: [...this.order],
      activeIndex: this.activeIndex,
    });
  }

  // --- Public API ---

  /** Show/hide the tracker panel. */
  setVisible(visible) {
    this.el.style.display = visible ? 'flex' : 'none';
  }

  /** Update the player list (e.g. when characters are added/removed). */
  setPlayers(players) {
    this.players = [...players];

    // Remove any ordered characters that no longer exist
    if (this.order.length > 0) {
      const validIds = new Set(players.map(p => p.characterId));
      this.order = this.order.filter(id => validIds.has(id));
      if (this.activeIndex >= this.order.length) {
        this.activeIndex = Math.max(0, this.order.length - 1);
      }
    }

    // Clean up initiative rolls for removed characters
    const validCharIds = new Set(players.map(p => p.characterId));
    for (const [charId] of this.initiativeRolls) {
      if (!validCharIds.has(charId)) {
        this.initiativeRolls.delete(charId);
      }
    }

    this._render();
  }

  /**
   * Apply a remote turn state update (from WebSocket).
   * @param {{ enabled: boolean, order: number[], activeIndex: number }} state
   */
  setTurnState(state) {
    console.log('[TurnTracker] setTurnState called', JSON.stringify(state));
    console.log('[TurnTracker] current players:', this.players.map(p => `${p.name}(${p.characterId})`));
    this.enabled = state.enabled;
    this.order = state.order || [];
    this.activeIndex = typeof state.activeIndex === 'number' ? state.activeIndex : -1;

    if (!this.enabled) {
      this.order = [];
      this.activeIndex = -1;
      this.turnCounter = 0;
    }

    // Apply sorted player order if included (from DM sort action)
    if (state.sortedPlayerOrder && Array.isArray(state.sortedPlayerOrder) && state.sortedPlayerOrder.length > 0) {
      console.log('[TurnTracker] applying sortedPlayerOrder:', state.sortedPlayerOrder);
      this.applySortOrder(state.sortedPlayerOrder);
    } else {
      console.log('[TurnTracker] no sortedPlayerOrder in state');
    }

    this.setVisible(this.enabled);
    this._render();
  }

  /**
   * Set an initiative roll for a character (from remote WebSocket update).
   * @param {number} characterId
   * @param {number|null} roll
   */
  setInitiativeRoll(characterId, roll) {
    if (roll != null) {
      this.initiativeRolls.set(characterId, roll);
    } else {
      this.initiativeRolls.delete(characterId);
    }
    this._render();
  }

  /**
   * Apply a sorted initiative order from a remote WebSocket update.
   * Rebuilds the local player list to match the sorted character ID order.
   * @param {number[]} sortedCharIds – character IDs in sorted order
   */
  applySortOrder(sortedCharIds) {
    console.log('[TurnTracker] applySortOrder called with:', sortedCharIds);
    console.log('[TurnTracker] current this.players:', this.players.map(p => `${p.name}(${p.characterId})`));
    if (!sortedCharIds || sortedCharIds.length === 0) { console.log('[TurnTracker] BAIL: empty sortedCharIds'); return; }
    if (this.players.length === 0) { console.log('[TurnTracker] BAIL: empty this.players'); return; }

    // Rebuild the player list in the exact broadcast order
    // Use direct lookup instead of Array.sort to avoid any comparison issues
    const playerMap = new Map();
    for (const p of this.players) {
      playerMap.set(Number(p.characterId), p);
    }
    console.log('[TurnTracker] playerMap keys:', [...playerMap.keys()]);

    const reordered = [];
    for (const id of sortedCharIds) {
      const numId = Number(id);
      const p = playerMap.get(numId);
      console.log('[TurnTracker] lookup id', id, '(Number:', numId, ') found:', !!p);
      if (p) {
        reordered.push(p);
        playerMap.delete(numId);
      }
    }
    // Append any players not in the sorted list (shouldn't happen, but defensive)
    for (const p of playerMap.values()) {
      reordered.push(p);
    }

    console.log('[TurnTracker] reordered:', reordered.map(p => `${p.name}(${p.characterId})`));
    this.players = reordered;
    this._render();
  }

  /** Clear all initiative rolls (e.g. when action mode is disabled). */
  clearInitiativeRolls() {
    this.initiativeRolls.clear();
    this._render();
  }

  /** Get the current turn state. */
  getTurnState() {
    return {
      enabled: this.enabled,
      order: [...this.order],
      activeIndex: this.activeIndex,
    };
  }

  /** Get the active character ID, or null if no turn is active. */
  getActiveCharacterId() {
    if (!this.enabled || this.activeIndex < 0 || this.order.length === 0) {
      return null;
    }
    return this.order[this.activeIndex];
  }

  destroy() {
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }
}
