/**
 * Chat panel with Group chat and Direct Message tabs.
 * Collapsible, anchored to the bottom-right of the viewport.
 * Supports real-time messages via WebSocket + history loading from REST.
 * Includes dice rolling with animated results broadcast to group chat.
 */

export class ChatPanel {
  /**
   * @param {HTMLElement} container – DOM element to mount into
   * @param {{ id: number, username: string }} currentUser
   * @param {{ userId: number, username: string, role: string }[]} gamePlayers – all players in the game
   * @param {(content: string, recipientId: number|null, roll?: object) => void} onSend – callback to send a message
   */
  constructor(container, currentUser, gamePlayers, onSend) {
    this.container = container;
    this.currentUser = currentUser;
    this.onSend = onSend;
    this.collapsed = false;
    this.activeTab = 'group'; // 'group' or a recipientUserId (number)

    // Conversations: keyed by 'group' or recipientUserId
    this.conversations = new Map();
    this.conversations.set('group', []);

    // Unread counts per tab
    this.unread = new Map();
    this.unread.set('group', 0);

    // Build list of other players (not self)
    this.otherPlayers = gamePlayers.filter(p => p.userId !== currentUser.id);
    for (const p of this.otherPlayers) {
      this.conversations.set(p.userId, []);
      this.unread.set(p.userId, 0);
    }

    this._buildUI();
  }

  _buildUI() {
    this.panel = document.createElement('div');
    this.panel.id = 'chat-panel';

    this.panel.innerHTML = `
      <div class="chat-title-bar">
        <span class="chat-title">Chat</span>
        <span class="chat-unread-total" style="display:none"></span>
        <button class="chat-collapse-btn">&minus;</button>
      </div>
      <div class="chat-body">
        <div class="chat-tabs"></div>
        <div class="chat-messages"></div>
        <div class="chat-input-area">
          <textarea class="chat-input" placeholder="Type a message..." rows="1"></textarea>
          <div class="chat-dice-wrapper">
            <button class="chat-dice-btn" title="Roll dice">\u{1F3B2}</button>
            <div class="chat-dice-menu" style="display:none">
              <div class="chat-dice-presets">
                <button class="chat-dice-preset" data-sides="4">d4</button>
                <button class="chat-dice-preset" data-sides="6">d6</button>
                <button class="chat-dice-preset" data-sides="8">d8</button>
                <button class="chat-dice-preset" data-sides="10">d10</button>
                <button class="chat-dice-preset" data-sides="12">d12</button>
                <button class="chat-dice-preset" data-sides="20">d20</button>
                <button class="chat-dice-preset" data-sides="100">d100</button>
              </div>
              <div class="chat-dice-custom">
                <input type="number" class="chat-dice-count" min="1" max="10" value="1" />
                <span class="chat-dice-d">d</span>
                <input type="number" class="chat-dice-sides" min="2" max="100" value="20" />
                <button class="chat-dice-roll-btn">Roll</button>
              </div>
            </div>
          </div>
          <button class="chat-send-btn">Send</button>
        </div>
      </div>
    `;

    this.container.appendChild(this.panel);

    // Cache DOM elements
    this.titleBar = this.panel.querySelector('.chat-title-bar');
    this.unreadTotalEl = this.panel.querySelector('.chat-unread-total');
    this.collapseBtn = this.panel.querySelector('.chat-collapse-btn');
    this.body = this.panel.querySelector('.chat-body');
    this.tabsEl = this.panel.querySelector('.chat-tabs');
    this.messagesEl = this.panel.querySelector('.chat-messages');
    this.inputEl = this.panel.querySelector('.chat-input');
    this.sendBtn = this.panel.querySelector('.chat-send-btn');
    this.diceBtn = this.panel.querySelector('.chat-dice-btn');
    this.diceMenu = this.panel.querySelector('.chat-dice-menu');

    // Events
    this.titleBar.addEventListener('click', (e) => {
      if (e.target.closest('.chat-collapse-btn')) return;
      this._toggleCollapse();
    });
    this.collapseBtn.addEventListener('click', () => this._toggleCollapse());

    this.sendBtn.addEventListener('click', () => this._sendMessage());

    // Enter to send, Shift+Enter for newline
    this.inputEl.addEventListener('keydown', (e) => {
      // Stop propagation so WASD/arrows/QE don't fire while typing
      e.stopPropagation();

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });

    // Also stop keyup propagation so InputManager doesn't see key releases
    this.inputEl.addEventListener('keyup', (e) => {
      e.stopPropagation();
    });

    // Auto-resize textarea
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 80) + 'px';
    });

    // --- Dice roll UI ---
    this.diceBtn.addEventListener('click', () => {
      const visible = this.diceMenu.style.display !== 'none';
      this.diceMenu.style.display = visible ? 'none' : 'block';
    });

    // Preset dice buttons (d4, d6, d8, d10, d12, d20, d100)
    for (const btn of this.panel.querySelectorAll('.chat-dice-preset')) {
      btn.addEventListener('click', () => {
        const sides = parseInt(btn.dataset.sides, 10);
        this._rollDice(1, sides);
        this.diceMenu.style.display = 'none';
      });
    }

    // Custom roll button
    this.panel.querySelector('.chat-dice-roll-btn').addEventListener('click', () => {
      const countInput = this.panel.querySelector('.chat-dice-count');
      const sidesInput = this.panel.querySelector('.chat-dice-sides');
      const count = Math.max(1, Math.min(10, parseInt(countInput.value, 10) || 1));
      const sides = Math.max(2, Math.min(100, parseInt(sidesInput.value, 10) || 20));
      this._rollDice(count, sides);
      this.diceMenu.style.display = 'none';
    });

    // Stop propagation on dice menu inputs so game controls don't fire
    for (const input of this.panel.querySelectorAll('.chat-dice-count, .chat-dice-sides')) {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          this.panel.querySelector('.chat-dice-roll-btn').click();
        }
      });
      input.addEventListener('keyup', (e) => e.stopPropagation());
    }

    // Close dice menu when clicking outside
    this._onDocClick = (e) => {
      if (!this.panel.querySelector('.chat-dice-wrapper').contains(e.target)) {
        this.diceMenu.style.display = 'none';
      }
    };
    document.addEventListener('click', this._onDocClick);

    this._renderTabs();
    this._renderMessages();
  }

  _toggleCollapse() {
    this.collapsed = !this.collapsed;
    this.body.style.display = this.collapsed ? 'none' : 'flex';
    this.collapseBtn.textContent = this.collapsed ? '+' : '\u2212';
    this._updateUnreadTotal();
  }

  _renderTabs() {
    this.tabsEl.innerHTML = '';

    // Group tab
    const groupTab = this._createTab('group', 'Group', this.unread.get('group') || 0);
    this.tabsEl.appendChild(groupTab);

    // DM tabs for each other player
    for (const p of this.otherPlayers) {
      const tab = this._createTab(p.userId, p.username, this.unread.get(p.userId) || 0);
      this.tabsEl.appendChild(tab);
    }
  }

  _createTab(key, label, unreadCount) {
    const tab = document.createElement('button');
    tab.className = `chat-tab${this.activeTab === key ? ' active' : ''}`;
    tab.dataset.key = String(key);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;
    tab.appendChild(nameSpan);

    if (unreadCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'chat-unread-badge';
      tab.appendChild(badge);
    }

    tab.addEventListener('click', () => {
      this.activeTab = key;
      this.unread.set(key, 0);
      this._renderTabs();
      this._renderMessages();
      this._updateUnreadTotal();
      this._scrollToBottom();
      this.inputEl.focus();
    });

    return tab;
  }

  _renderMessages() {
    this.messagesEl.innerHTML = '';

    const msgs = this.conversations.get(this.activeTab) || [];
    for (const msg of msgs) {
      this.messagesEl.appendChild(this._createMessageEl(msg, false));
    }

    this._scrollToBottom();
  }

  _createMessageEl(msg, animate = true) {
    const div = document.createElement('div');
    const isOwn = msg.senderId === this.currentUser.id;
    const isDM = msg.recipientId != null;
    const isRoll = !!msg.roll;
    div.className = `chat-msg${isOwn ? ' own' : ''}${isDM ? ' dm' : ''}${isRoll ? ' dice-roll' : ''}`;

    const header = document.createElement('div');
    header.className = 'chat-msg-header';

    const name = document.createElement('span');
    name.className = 'chat-msg-name';
    name.textContent = isOwn ? 'You' : msg.senderName;
    header.appendChild(name);

    if (isDM) {
      const dmLabel = document.createElement('span');
      dmLabel.className = 'chat-msg-dm-label';
      dmLabel.textContent = 'DM';
      header.appendChild(dmLabel);
    }

    const time = document.createElement('span');
    time.className = 'chat-msg-time';
    time.textContent = this._formatTime(msg.createdAt);
    header.appendChild(time);

    div.appendChild(header);

    if (isRoll) {
      // Rich dice roll rendering
      const rollBody = this._createRollBody(msg.roll, animate);
      div.appendChild(rollBody);
    } else {
      // Normal text message
      const body = document.createElement('div');
      body.className = 'chat-msg-body';
      body.textContent = msg.content;
      div.appendChild(body);
    }

    return div;
  }

  /**
   * Create the rich dice roll body element.
   */
  _createRollBody(roll, animate) {
    const body = document.createElement('div');
    body.className = 'chat-msg-body dice-roll-body';

    // Notation line: 🎲 1d20
    const notation = document.createElement('div');
    notation.className = 'dice-notation';
    notation.textContent = `\u{1F3B2} ${roll.count}d${roll.sides}`;
    body.appendChild(notation);

    // Dice results row
    const resultsRow = document.createElement('div');
    resultsRow.className = 'dice-results';

    for (let i = 0; i < roll.results.length; i++) {
      const val = roll.results[i];
      const die = document.createElement('span');
      die.className = 'dice-result';

      // Crit / fumble highlighting for d20
      if (roll.sides === 20 && roll.count === 1) {
        if (val === 20) die.classList.add('crit');
        else if (val === 1) die.classList.add('fumble');
      }

      // Stagger animation delay
      if (animate) {
        die.style.animationDelay = `${i * 0.1}s`;
      } else {
        die.classList.add('no-anim');
      }

      die.textContent = val;
      resultsRow.appendChild(die);
    }

    body.appendChild(resultsRow);

    // Total line (show for multi-die rolls)
    if (roll.count > 1) {
      const total = document.createElement('div');
      total.className = 'dice-total';
      total.textContent = `Total: ${roll.total}`;
      body.appendChild(total);
    }

    return body;
  }

  _formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  _scrollToBottom() {
    // Only auto-scroll if user is near the bottom
    const el = this.messagesEl;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom || el.scrollTop === 0) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }

  _sendMessage() {
    const content = this.inputEl.value.trim();
    if (!content) return;

    const recipientId = this.activeTab === 'group' ? null : this.activeTab;

    // Optimistically add the message locally so it appears immediately
    const localMsg = {
      id: null, // Will be assigned by server
      senderId: this.currentUser.id,
      senderName: this.currentUser.username,
      recipientId,
      content,
      createdAt: new Date().toISOString(),
      _local: true, // Flag to identify locally-added messages
    };
    this.addMessage(localMsg);

    this.onSend(content, recipientId);

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.inputEl.focus();
  }

  /**
   * Roll dice and broadcast result to group chat.
   * @param {number} count – number of dice
   * @param {number} sides – sides per die
   */
  _rollDice(count, sides) {
    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(Math.floor(Math.random() * sides) + 1);
    }
    const total = results.reduce((a, b) => a + b, 0);
    const notation = `${count}d${sides}`;
    const content = `rolled ${notation}: [${results.join(', ')}] = ${total}`;
    const roll = { sides, count, results, total };

    // Optimistically add locally
    const localMsg = {
      id: null,
      senderId: this.currentUser.id,
      senderName: this.currentUser.username,
      recipientId: null, // Always group
      content,
      roll,
      createdAt: new Date().toISOString(),
      _local: true,
    };

    // Switch to group tab so user sees the roll
    if (this.activeTab !== 'group') {
      this.activeTab = 'group';
      this.unread.set('group', 0);
      this._renderTabs();
      this._renderMessages();
    }

    this.addMessage(localMsg);
    this.onSend(content, null, roll);
  }

  /**
   * Add a single incoming message (from WebSocket or local send).
   */
  addMessage(msg) {
    // Skip server echo of our own messages (already added locally)
    if (!msg._local && msg.senderId === this.currentUser.id) {
      // Update the local message's id with the server-assigned one
      const key = this._getConversationKey(msg);
      const convo = this.conversations.get(key);
      if (convo) {
        const local = convo.find(m => m._local && m.content === msg.content);
        if (local) {
          local.id = msg.id;
          local._local = false;
          return;
        }
      }
    }

    // Determine which conversation this message belongs to
    const key = this._getConversationKey(msg);

    if (!this.conversations.has(key)) {
      this.conversations.set(key, []);
      this.unread.set(key, 0);
    }

    this.conversations.get(key).push(msg);

    // Update unread if this tab isn't active or panel is collapsed
    if (key !== this.activeTab || this.collapsed) {
      this.unread.set(key, (this.unread.get(key) || 0) + 1);
      this._renderTabs();
      this._updateUnreadTotal();
    }

    // If viewing this conversation, append the message element
    if (key === this.activeTab && !this.collapsed) {
      this.messagesEl.appendChild(this._createMessageEl(msg));
      this._scrollToBottom();
    }
  }

  /**
   * Determine which conversation key a message belongs to.
   */
  _getConversationKey(msg) {
    if (msg.recipientId == null) return 'group';
    // DM: key is the *other* user's ID
    if (msg.senderId === this.currentUser.id) return msg.recipientId;
    return msg.senderId;
  }

  /**
   * Bulk-load message history (from REST API).
   */
  loadHistory(messages) {
    for (const msg of messages) {
      const key = this._getConversationKey(msg);
      if (!this.conversations.has(key)) {
        this.conversations.set(key, []);
        this.unread.set(key, 0);
      }
      this.conversations.get(key).push(msg);
    }
    this._renderMessages();
  }

  /**
   * Update available DM targets when the roster changes.
   */
  setPlayers(gamePlayers) {
    this.otherPlayers = gamePlayers.filter(p => p.userId !== this.currentUser.id);

    // Ensure conversations exist for all players
    for (const p of this.otherPlayers) {
      if (!this.conversations.has(p.userId)) {
        this.conversations.set(p.userId, []);
        this.unread.set(p.userId, 0);
      }
    }

    this._renderTabs();
  }

  _updateUnreadTotal() {
    let total = 0;
    for (const [, count] of this.unread) {
      total += count;
    }

    if (total > 0) {
      this.unreadTotalEl.textContent = total > 99 ? '99+' : String(total);
      this.unreadTotalEl.style.display = 'inline-flex';
    } else {
      this.unreadTotalEl.style.display = 'none';
    }
  }

  destroy() {
    document.removeEventListener('click', this._onDocClick);
    this.container.innerHTML = '';
  }
}
