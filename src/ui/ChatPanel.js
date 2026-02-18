/**
 * Chat panel with Group chat and Direct Message tabs.
 * Collapsible, anchored to the bottom-right of the viewport.
 * Supports real-time messages via WebSocket + history loading from REST.
 */

export class ChatPanel {
  /**
   * @param {HTMLElement} container – DOM element to mount into
   * @param {{ id: number, username: string }} currentUser
   * @param {{ userId: number, username: string, role: string }[]} gamePlayers – all players in the game
   * @param {(content: string, recipientId: number|null) => void} onSend – callback to send a message
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
      this.messagesEl.appendChild(this._createMessageEl(msg));
    }

    this._scrollToBottom();
  }

  _createMessageEl(msg) {
    const div = document.createElement('div');
    const isOwn = msg.senderId === this.currentUser.id;
    const isDM = msg.recipientId != null;
    div.className = `chat-msg${isOwn ? ' own' : ''}${isDM ? ' dm' : ''}`;

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

    const body = document.createElement('div');
    body.className = 'chat-msg-body';
    body.textContent = msg.content;

    div.appendChild(header);
    div.appendChild(body);
    return div;
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
    this.container.innerHTML = '';
  }
}
