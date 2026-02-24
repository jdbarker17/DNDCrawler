/**
 * Map Library modal overlay.
 * Allows DMs to save maps to their personal library,
 * browse saved maps, load them, and delete them.
 */

import { getSavedMaps, createSavedMap, getSavedMap, deleteSavedMap } from '../services/api.js';

export class MapLibrary {
  /**
   * @param {HTMLElement} container – parent to mount the overlay into
   * @param {(mapData: object) => void} onLoad – called when user picks a map to load
   * @param {() => void} onClose – called when user closes the library
   * @param {{ mapData: object, defaultName: string } | null} saveContext
   *   – if provided, shows a "Save current map" form at the top
   */
  constructor(container, onLoad, onClose, saveContext = null) {
    this.container = container;
    this.onLoad = onLoad;
    this.onClose = onClose;
    this.saveContext = saveContext;
    this.maps = [];

    this._build();
    this._refresh();
  }

  _build() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'map-library-overlay';

    const saveSection = this.saveContext ? `
      <div class="ml-save-section">
        <input type="text" id="ml-save-name" placeholder="Map name..." value="${this.saveContext.defaultName || ''}">
        <button class="mc-btn primary" id="ml-save-btn">Save to Library</button>
      </div>
    ` : '';

    this.overlay.innerHTML = `
      <div class="ml-modal">
        <div class="ml-header">
          <h2>Map Library</h2>
          <button class="ml-close-btn" id="ml-close">&times;</button>
        </div>
        ${saveSection}
        <div class="ml-list" id="ml-list">
          <div class="ml-loading">Loading...</div>
        </div>
      </div>
    `;

    this.container.appendChild(this.overlay);

    // Close button
    this.overlay.querySelector('#ml-close').addEventListener('click', () => {
      if (this.onClose) this.onClose();
    });

    // Click outside modal to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        if (this.onClose) this.onClose();
      }
    });

    // Save button
    if (this.saveContext) {
      this.overlay.querySelector('#ml-save-btn').addEventListener('click', () => {
        this._saveToLibrary();
      });
      // Enter key in name input
      this.overlay.querySelector('#ml-save-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._saveToLibrary();
      });
    }
  }

  async _refresh() {
    try {
      this.maps = await getSavedMaps();
      this._renderList();
    } catch (err) {
      console.error('Failed to load saved maps:', err);
      const list = this.overlay.querySelector('#ml-list');
      list.innerHTML = '<div class="ml-empty">Failed to load maps.</div>';
    }
  }

  _renderList() {
    const list = this.overlay.querySelector('#ml-list');

    if (this.maps.length === 0) {
      list.innerHTML = '<div class="ml-empty">No saved maps yet. Save a map from the editor to get started.</div>';
      return;
    }

    list.innerHTML = this.maps.map(m => {
      const dims = (m.width && m.height) ? `${m.width}x${m.height}` : '?';
      const date = this._formatDate(m.updated_at || m.created_at);
      return `
        <div class="ml-map-item" data-id="${m.id}">
          <div class="ml-map-info">
            <div class="ml-map-name">${m.name}</div>
            <div class="ml-map-meta">${dims} · ${date}</div>
          </div>
          <div class="ml-map-actions">
            <button class="mc-btn small ml-load-btn" data-id="${m.id}">Load</button>
            <button class="mc-btn small mc-danger ml-delete-btn" data-id="${m.id}">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach load handlers
    list.querySelectorAll('.ml-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._loadMap(parseInt(btn.dataset.id, 10));
      });
    });

    // Attach delete handlers
    list.querySelectorAll('.ml-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        const map = this.maps.find(m => m.id === id);
        this._deleteMap(id, map ? map.name : 'this map');
      });
    });
  }

  async _saveToLibrary() {
    if (!this.saveContext) return;

    const nameInput = this.overlay.querySelector('#ml-save-name');
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      nameInput.style.borderColor = '#e74c3c';
      setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
      return;
    }

    const btn = this.overlay.querySelector('#ml-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      await createSavedMap(name, this.saveContext.mapData);
      nameInput.value = '';
      btn.textContent = 'Saved!';
      setTimeout(() => {
        btn.textContent = 'Save to Library';
        btn.disabled = false;
      }, 1500);
      this._refresh();
    } catch (err) {
      console.error('Failed to save map:', err);
      btn.textContent = 'Save to Library';
      btn.disabled = false;
      alert('Failed to save map.');
    }
  }

  async _loadMap(mapId) {
    try {
      const data = await getSavedMap(mapId);
      if (this.onLoad) this.onLoad(data.map_data);
      if (this.onClose) this.onClose();
    } catch (err) {
      console.error('Failed to load map:', err);
      alert('Failed to load map.');
    }
  }

  async _deleteMap(mapId, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      await deleteSavedMap(mapId);
      this._refresh();
    } catch (err) {
      console.error('Failed to delete map:', err);
      alert('Failed to delete map.');
    }
  }

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  }

  destroy() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }
}
