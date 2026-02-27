/**
 * MonsterPanel – collapsible bottom-left panel for the DM to add monsters.
 * Only rendered for users with the 'dm' role.
 */

export class MonsterPanel {
  /**
   * @param {HTMLElement} container – DOM element to mount into
   * @param {string} role – 'dm' | 'player'
   * @param {(monsterData: object) => void} onAddMonster – callback to add a monster
   */
  constructor(container, role, onAddMonster) {
    this.container = container;
    this.role = role;
    this.onAddMonster = onAddMonster;
    this._collapsed = true;
    this._monsterImageData = null;

    if (this.role === 'dm') {
      this._build();
    }
  }

  _build() {
    this.el = document.createElement('div');
    this.el.id = 'monster-panel';
    this.el.innerHTML = `
      <button class="monster-panel-toggle" id="monster-panel-toggle">
        <span class="monster-panel-icon">&#x1F47E;</span>
        <span class="monster-panel-label">Monsters</span>
        <span class="monster-panel-arrow" id="monster-panel-arrow">&#x25B2;</span>
      </button>
      <div class="monster-panel-body" id="monster-panel-body" style="display:none">
        <div class="monster-panel-presets">
          <button class="monster-preset-btn" data-name="Goblin" data-hp="7" data-color="#2d8a3e" data-speed="30" data-creature="goblin" data-size="small">Goblin</button>
          <button class="monster-preset-btn" data-name="Skeleton" data-hp="13" data-color="#c8c8c8" data-speed="30" data-creature="skeleton" data-size="medium">Skeleton</button>
          <button class="monster-preset-btn" data-name="Orc" data-hp="15" data-color="#5a7a3a" data-speed="30" data-creature="orc" data-size="medium">Orc</button>
          <button class="monster-preset-btn" data-name="Wolf" data-hp="11" data-color="#7a6a5a" data-speed="40" data-creature="wolf" data-size="medium">Wolf</button>
          <button class="monster-preset-btn" data-name="Dragon" data-hp="178" data-color="#8b1a1a" data-speed="40" data-creature="dragon" data-size="large">Dragon</button>
        </div>
        <div class="monster-field-row">
          <input type="text" id="mp-name" placeholder="Monster name" class="monster-field" />
        </div>
        <div class="monster-field-row">
          <input type="number" id="mp-hp" placeholder="HP" class="monster-field monster-field-sm" min="1" />
          <input type="color" id="mp-color" value="#e74c3c" class="monster-color-pick" title="Token color" />
        </div>
        <div class="monster-field-row">
          <select id="mp-speed" class="monster-field">
            <option value="20">20 ft</option>
            <option value="25">25 ft</option>
            <option value="30" selected>30 ft</option>
            <option value="35">35 ft</option>
            <option value="40">40 ft</option>
            <option value="50">50 ft</option>
            <option value="60">60 ft</option>
          </select>
          <label class="monster-file-label">
            <span>Image</span>
            <input type="file" id="mp-image" accept="image/*" class="monster-file-input" />
          </label>
        </div>
        <div class="monster-field-row">
          <select id="mp-creature" class="monster-field">
            <option value="humanoid">Humanoid</option>
            <option value="skeleton">Skeleton</option>
            <option value="goblin">Goblin</option>
            <option value="orc">Orc</option>
            <option value="wolf">Wolf</option>
            <option value="dragon">Dragon</option>
          </select>
          <select id="mp-size" class="monster-field">
            <option value="small">Small (1sq)</option>
            <option value="medium" selected>Medium (1sq)</option>
            <option value="large">Large (2×2)</option>
          </select>
        </div>
        <div class="monster-img-preview" id="mp-img-preview" style="display:none">
          <img id="mp-img-thumb" />
          <button class="monster-clear-img" id="mp-clear-img" title="Remove image">&times;</button>
        </div>
        <button class="monster-submit-btn" id="mp-submit">Add Monster</button>
      </div>
    `;
    this.container.appendChild(this.el);

    this._attachEvents();
  }

  _attachEvents() {
    // Toggle collapse
    this.el.querySelector('#monster-panel-toggle').addEventListener('click', () => {
      this._collapsed = !this._collapsed;
      this.el.querySelector('#monster-panel-body').style.display = this._collapsed ? 'none' : 'flex';
      this.el.querySelector('#monster-panel-arrow').textContent = this._collapsed ? '\u25B2' : '\u25BC';
    });

    // Presets
    this.el.querySelectorAll('.monster-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.el.querySelector('#mp-name').value = btn.dataset.name;
        this.el.querySelector('#mp-hp').value = btn.dataset.hp;
        this.el.querySelector('#mp-color').value = btn.dataset.color;
        this.el.querySelector('#mp-speed').value = btn.dataset.speed;
        this.el.querySelector('#mp-creature').value = btn.dataset.creature || 'humanoid';
        this.el.querySelector('#mp-size').value = btn.dataset.size || 'medium';
      });
    });

    // Image upload
    this.el.querySelector('#mp-image').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this._processImage(file);
    });

    // Clear image
    this.el.querySelector('#mp-clear-img').addEventListener('click', () => {
      this._monsterImageData = null;
      this.el.querySelector('#mp-img-preview').style.display = 'none';
      this.el.querySelector('#mp-image').value = '';
    });

    // Submit
    this.el.querySelector('#mp-submit').addEventListener('click', () => {
      this._submit();
    });
  }

  _processImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 256;
        let w = img.width;
        let h = img.height;
        if (w > maxSize || h > maxSize) {
          const scale = maxSize / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        this._monsterImageData = canvas.toDataURL('image/jpeg', 0.7);

        const preview = this.el.querySelector('#mp-img-preview');
        const thumb = this.el.querySelector('#mp-img-thumb');
        thumb.src = this._monsterImageData;
        preview.style.display = 'flex';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  _submit() {
    const name = this.el.querySelector('#mp-name').value.trim();
    const hpRaw = this.el.querySelector('#mp-hp').value;
    const color = this.el.querySelector('#mp-color').value;
    const speed = parseInt(this.el.querySelector('#mp-speed').value, 10);

    if (!name) {
      alert('Monster name is required');
      return;
    }

    const hp = hpRaw ? parseInt(hpRaw, 10) : null;
    if (hp !== null && (isNaN(hp) || hp < 1)) {
      alert('HP must be a positive number');
      return;
    }

    const creature_type = this.el.querySelector('#mp-creature').value;
    const size = this.el.querySelector('#mp-size').value;

    const data = {
      name,
      hp,
      max_hp: hp,
      color,
      speed,
      monster_image: this._monsterImageData || null,
      creature_type,
      size,
    };

    if (this.onAddMonster) {
      this.onAddMonster(data);
    }

    // Reset form
    this.el.querySelector('#mp-name').value = '';
    this.el.querySelector('#mp-hp').value = '';
    this.el.querySelector('#mp-color').value = '#e74c3c';
    this.el.querySelector('#mp-speed').value = '30';
    this.el.querySelector('#mp-creature').value = 'humanoid';
    this.el.querySelector('#mp-size').value = 'medium';
    this.el.querySelector('#mp-image').value = '';
    this._monsterImageData = null;
    this.el.querySelector('#mp-img-preview').style.display = 'none';
  }

  destroy() {
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }
}
