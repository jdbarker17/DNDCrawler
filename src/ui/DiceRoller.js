/**
 * DiceRoller.js
 *
 * Tabbed dice rolling panel with quick-roll buttons, modifier control,
 * custom macro management, and a Quick Checks sidebar for common D&D ability/skill checks.
 * Sits on the right side of the screen. Rolls broadcast to chat via onRoll callback.
 */

import { rollFormula, validateFormula } from '../engine/DiceFormulaParser.js';
import { getMacros, createMacro, updateMacro, deleteMacro } from '../services/api.js';

const DICE_PRESETS = [
  { label: 'd4', sides: 4 },
  { label: 'd6', sides: 6 },
  { label: 'd8', sides: 8 },
  { label: 'd10', sides: 10 },
  { label: 'd12', sides: 12 },
  { label: 'd20', sides: 20 },
  { label: 'd100', sides: 100 },
];

const CATEGORY_LABELS = {
  attack: 'Attack',
  ability: 'Ability',
  save: 'Save',
  skill: 'Skill',
  spell: 'Spell',
  custom: 'Custom',
};

const DEFAULT_CHECKS = [
  { name: 'DEX', label: 'Dexterity' },
  { name: 'STR', label: 'Strength' },
  { name: 'WIS', label: 'Wisdom' },
  { name: 'INT', label: 'Knowledge' },
  { name: 'SPOT', label: 'Spot' },
];

const CHECKS_STORAGE_KEY = 'dnd_quick_checks';

export class DiceRoller {
  /**
   * @param {HTMLElement} container - DOM element to mount into
   * @param {{ id: number, username: string }} currentUser
   * @param {string} role - 'dm' or 'player'
   * @param {(content: string, recipientId: null, roll: object) => void} onRoll
   */
  constructor(container, currentUser, role, onRoll) {
    this.container = container;
    this.currentUser = currentUser;
    this.role = role;
    this.onRoll = onRoll;
    this.collapsed = false;
    this.activeTab = 'quick'; // 'quick' | 'macros'
    this.activeCharacterId = null;
    this.macros = [];
    this.rollHistory = []; // last 20 rolls
    this.editingMacroId = null; // null = creating new, number = editing existing
    this.quickChecks = this._loadChecks();
    this.checksVisible = true;
    this.checkModsVisible = false;
    this.modifierVisible = false;
    this._build();
  }

  // --- Quick Checks persistence (localStorage per-character) ---

  _checksKey() {
    return `${CHECKS_STORAGE_KEY}_${this.activeCharacterId || 'default'}`;
  }

  _loadChecks() {
    try {
      const key = `${CHECKS_STORAGE_KEY}_${this.activeCharacterId || 'default'}`;
      const stored = localStorage.getItem(key);
      if (stored) return JSON.parse(stored);
    } catch (e) { /* ignore */ }
    // Return defaults with modifier 0
    return DEFAULT_CHECKS.map(c => ({ ...c, modifier: 0 }));
  }

  _saveChecks() {
    try {
      localStorage.setItem(this._checksKey(), JSON.stringify(this.quickChecks));
    } catch (e) { /* ignore */ }
  }

  _build() {
    this.el = document.createElement('div');
    this.el.id = 'dice-roller-wrapper';
    this.el.innerHTML = `
      <!-- Quick Checks Sidebar -->
      <div id="dice-checks-sidebar">
        <div class="dice-checks-header dice-toggle-header">
          <span class="dice-toggle-arrow">${this.checksVisible ? '\u25BC' : '\u25B6'}</span> Checks
        </div>
        <div class="dice-checks-body"${this.checksVisible ? '' : ' style="display:none"'}>
          <div class="dice-checks-list"></div>
          <button class="dice-checks-add-btn" title="Add custom check">+</button>
          <div class="dice-checks-add-form" style="display:none">
            <input type="text" class="dice-checks-add-name" placeholder="Name" maxlength="10" />
            <input type="text" class="dice-checks-add-label" placeholder="Full label" maxlength="30" />
            <div class="dice-checks-add-actions">
              <button class="dice-checks-save-btn">Add</button>
              <button class="dice-checks-cancel-btn">&times;</button>
            </div>
          </div>
        </div>
      </div>
      <!-- Main Dice Roller Panel -->
      <div id="dice-roller">
        <div class="dice-roller-title-bar">
          <span class="dice-roller-title">\u{1F3B2} Dice Roller</span>
          <button class="dice-roller-collapse-btn">&minus;</button>
        </div>
        <div class="dice-roller-body">
          <div class="dice-roller-tabs">
            <button class="dice-roller-tab active" data-tab="quick">Quick Roll</button>
            <button class="dice-roller-tab" data-tab="macros">Macros</button>
          </div>
          <div class="dice-roller-tab-content">
            <!-- Quick Roll Tab -->
            <div class="dice-roller-panel" data-panel="quick">
              <div class="dice-count-row">
                <label>Count:</label>
                <input type="number" class="dice-count-input" min="1" max="10" value="1" />
              </div>
              <div class="dice-quick-grid">
                ${DICE_PRESETS.map(d => `<button class="dice-quick-btn" data-sides="${d.sides}">${d.label}</button>`).join('')}
              </div>
              <div class="dice-modifier-row">
                <label class="dice-toggle-header dice-modifier-toggle">
                  <span class="dice-toggle-arrow">${this.modifierVisible ? '\u25BC' : '\u25B6'}</span> Modifier:
                </label>
                <div class="dice-modifier-body"${this.modifierVisible ? '' : ' style="display:none"'}>
                  <div class="dice-modifier-controls">
                    <button class="dice-mod-step" data-step="-1">&minus;</button>
                    <input type="number" class="dice-modifier-input" value="0" />
                    <button class="dice-mod-step" data-step="1">+</button>
                  </div>
                  <button class="dice-mod-clear">Clear</button>
                </div>
              </div>
              <div class="dice-custom-row">
                <input type="text" class="dice-formula-input" placeholder="Custom: 2d6+5" />
                <button class="dice-custom-roll-btn">Roll</button>
              </div>
              <div class="dice-history-label">Recent Rolls</div>
              <div class="dice-history"></div>
            </div>
            <!-- Macros Tab -->
            <div class="dice-roller-panel" data-panel="macros" style="display:none">
              <div class="dice-macro-list"></div>
              <button class="dice-macro-add-btn">+ New Macro</button>
              <div class="dice-macro-form" style="display:none">
                <input type="text" class="dice-macro-name" placeholder="Macro name (e.g. Greatsword Attack)" maxlength="50" />
                <input type="text" class="dice-macro-formula" placeholder="Formula (e.g. 1d20+7)" maxlength="100" />
                <input type="text" class="dice-macro-desc" placeholder="Description (e.g. STR + proficiency)" maxlength="200" />
                <select class="dice-macro-category">
                  <option value="attack">Attack</option>
                  <option value="ability">Ability Check</option>
                  <option value="save">Saving Throw</option>
                  <option value="skill">Skill Check</option>
                  <option value="spell">Spell</option>
                  <option value="custom">Custom</option>
                </select>
                <div class="dice-macro-form-actions">
                  <button class="dice-macro-save-btn">Save</button>
                  <button class="dice-macro-cancel-btn">Cancel</button>
                </div>
                <div class="dice-macro-form-error"></div>
              </div>
              <div class="dice-macro-empty" style="display:none">
                <p>No macros yet. Create one to save your frequent rolls!</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.el);

    // Adjust position based on role (DM has toolbar on the right)
    if (this.role === 'dm') {
      this.container.classList.add('dice-roller-dm');
    }

    this._renderChecks();
    this._attachEvents();
  }

  _attachEvents() {
    // Collapse toggle
    const titleBar = this.el.querySelector('.dice-roller-title-bar');
    titleBar.addEventListener('click', () => this.toggleCollapse());

    // Tab switching
    this.el.querySelectorAll('.dice-roller-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        this._switchTab(tab.dataset.tab);
      });
    });

    // Quick roll preset buttons
    this.el.querySelectorAll('.dice-quick-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sides = parseInt(btn.dataset.sides, 10);
        const count = parseInt(this.el.querySelector('.dice-count-input').value, 10) || 1;
        const mod = parseInt(this.el.querySelector('.dice-modifier-input').value, 10) || 0;
        let formula = `${count}d${sides}`;
        if (mod > 0) formula += `+${mod}`;
        else if (mod < 0) formula += `${mod}`;
        this._executeRoll(formula);
      });
    });

    // Count input — stop propagation so WASD doesn't trigger
    const countInput = this.el.querySelector('.dice-count-input');
    countInput.addEventListener('keydown', (e) => e.stopPropagation());
    countInput.addEventListener('keyup', (e) => e.stopPropagation());

    // Modifier input — stop propagation
    const modInput = this.el.querySelector('.dice-modifier-input');
    modInput.addEventListener('keydown', (e) => e.stopPropagation());
    modInput.addEventListener('keyup', (e) => e.stopPropagation());

    // Modifier step buttons (+/-)
    this.el.querySelectorAll('.dice-mod-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const step = parseInt(btn.dataset.step, 10);
        const current = parseInt(modInput.value, 10) || 0;
        modInput.value = current + step;
      });
    });

    // Modifier clear button
    this.el.querySelector('.dice-mod-clear').addEventListener('click', (e) => {
      e.stopPropagation();
      modInput.value = 0;
    });

    // Custom formula input
    const formulaInput = this.el.querySelector('.dice-formula-input');
    formulaInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        this._rollCustomFormula();
      }
    });
    formulaInput.addEventListener('keyup', (e) => e.stopPropagation());

    // Custom roll button
    this.el.querySelector('.dice-custom-roll-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._rollCustomFormula();
    });

    // Macro add button
    this.el.querySelector('.dice-macro-add-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._showMacroForm();
    });

    // Macro form — stop propagation on all inputs
    this.el.querySelectorAll('.dice-macro-form input, .dice-macro-form select').forEach(inp => {
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      inp.addEventListener('keyup', (e) => e.stopPropagation());
    });

    // Macro save
    this.el.querySelector('.dice-macro-save-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._saveMacro();
    });

    // Macro cancel
    this.el.querySelector('.dice-macro-cancel-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._hideMacroForm();
    });

    // Enter to save macro
    this.el.querySelector('.dice-macro-formula').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this._saveMacro();
    });

    // --- Toggle: Quick Checks sidebar ---
    this.el.querySelector('.dice-checks-header').addEventListener('click', (e) => {
      e.stopPropagation();
      this.checksVisible = !this.checksVisible;
      const body = this.el.querySelector('.dice-checks-body');
      const arrow = this.el.querySelector('.dice-checks-header .dice-toggle-arrow');
      body.style.display = this.checksVisible ? '' : 'none';
      arrow.textContent = this.checksVisible ? '\u25BC' : '\u25B6';
    });

    // --- Toggle: Modifier row ---
    this.el.querySelector('.dice-modifier-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      this.modifierVisible = !this.modifierVisible;
      const body = this.el.querySelector('.dice-modifier-body');
      const arrow = this.el.querySelector('.dice-modifier-toggle .dice-toggle-arrow');
      body.style.display = this.modifierVisible ? '' : 'none';
      arrow.textContent = this.modifierVisible ? '\u25BC' : '\u25B6';
    });

    // --- Quick Checks sidebar events ---
    this._attachChecksEvents();
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
    const body = this.el.querySelector('.dice-roller-body');
    const btn = this.el.querySelector('.dice-roller-collapse-btn');
    const sidebar = this.el.querySelector('#dice-checks-sidebar');
    body.style.display = this.collapsed ? 'none' : '';
    sidebar.style.display = this.collapsed ? 'none' : '';
    btn.textContent = this.collapsed ? '+' : '\u2212';
  }

  _switchTab(tab) {
    this.activeTab = tab;
    this.el.querySelectorAll('.dice-roller-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    this.el.querySelectorAll('.dice-roller-panel').forEach(p => {
      p.style.display = p.dataset.panel === tab ? '' : 'none';
    });
  }

  // --- Quick Checks Sidebar ---

  _renderChecks() {
    const listEl = this.el.querySelector('.dice-checks-list');
    const modsHidden = !this.checkModsVisible;
    listEl.innerHTML = `
      <div class="dice-check-mods-toggle dice-toggle-header" title="Toggle modifier controls">
        <span class="dice-toggle-arrow">${this.checkModsVisible ? '\u25BC' : '\u25B6'}</span> Modifiers
      </div>
    ` + this.quickChecks.map((c, i) => {
      const modDisplay = c.modifier >= 0 ? `+${c.modifier}` : `${c.modifier}`;
      const isCustom = !DEFAULT_CHECKS.some(d => d.name === c.name);
      return `
        <div class="dice-check-item" data-index="${i}">
          <button class="dice-check-roll-btn" data-index="${i}" title="${c.label}: 1d20${modDisplay}">
            ${this._esc(c.name)}
          </button>
          <div class="dice-check-mod"${modsHidden ? ' style="display:none"' : ''}>
            <button class="dice-check-mod-down" data-index="${i}">&minus;</button>
            <span class="dice-check-mod-val">${modDisplay}</span>
            <button class="dice-check-mod-up" data-index="${i}">+</button>
          </div>
          ${isCustom ? `<button class="dice-check-remove" data-index="${i}" title="Remove">&times;</button>` : ''}
        </div>
      `;
    }).join('');

    this._attachCheckListEvents();
  }

  _attachChecksEvents() {
    // Add check button
    this.el.querySelector('.dice-checks-add-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const form = this.el.querySelector('.dice-checks-add-form');
      const addBtn = this.el.querySelector('.dice-checks-add-btn');
      form.style.display = '';
      addBtn.style.display = 'none';
      form.querySelector('.dice-checks-add-name').value = '';
      form.querySelector('.dice-checks-add-label').value = '';
      form.querySelector('.dice-checks-add-name').focus();
    });

    // Add form inputs — stop propagation
    this.el.querySelectorAll('.dice-checks-add-form input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this._addCustomCheck();
        if (e.key === 'Escape') this._hideCheckForm();
      });
      inp.addEventListener('keyup', (e) => e.stopPropagation());
    });

    // Save custom check
    this.el.querySelector('.dice-checks-save-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._addCustomCheck();
    });

    // Cancel custom check
    this.el.querySelector('.dice-checks-cancel-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._hideCheckForm();
    });
  }

  _attachCheckListEvents() {
    // Toggle check modifiers
    const modsToggle = this.el.querySelector('.dice-check-mods-toggle');
    if (modsToggle) {
      modsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.checkModsVisible = !this.checkModsVisible;
        const arrow = modsToggle.querySelector('.dice-toggle-arrow');
        arrow.textContent = this.checkModsVisible ? '\u25BC' : '\u25B6';
        this.el.querySelectorAll('.dice-check-mod').forEach(el => {
          el.style.display = this.checkModsVisible ? '' : 'none';
        });
      });
    }

    // Roll buttons
    this.el.querySelectorAll('.dice-check-roll-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        const check = this.quickChecks[idx];
        if (!check) return;
        const mod = check.modifier;
        let formula = '1d20';
        if (mod > 0) formula += `+${mod}`;
        else if (mod < 0) formula += `${mod}`;
        this._executeRoll(formula, `${check.label} Check`);
      });
    });

    // Modifier down buttons
    this.el.querySelectorAll('.dice-check-mod-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        this.quickChecks[idx].modifier--;
        this._saveChecks();
        this._renderChecks();
      });
    });

    // Modifier up buttons
    this.el.querySelectorAll('.dice-check-mod-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        this.quickChecks[idx].modifier++;
        this._saveChecks();
        this._renderChecks();
      });
    });

    // Remove custom check buttons
    this.el.querySelectorAll('.dice-check-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        this.quickChecks.splice(idx, 1);
        this._saveChecks();
        this._renderChecks();
      });
    });
  }

  _addCustomCheck() {
    const form = this.el.querySelector('.dice-checks-add-form');
    const nameVal = form.querySelector('.dice-checks-add-name').value.trim().toUpperCase();
    const labelVal = form.querySelector('.dice-checks-add-label').value.trim();

    if (!nameVal) return;
    const label = labelVal || nameVal;

    this.quickChecks.push({ name: nameVal, label, modifier: 0 });
    this._saveChecks();
    this._renderChecks();
    this._hideCheckForm();
  }

  _hideCheckForm() {
    this.el.querySelector('.dice-checks-add-form').style.display = 'none';
    this.el.querySelector('.dice-checks-add-btn').style.display = '';
  }

  // --- Quick Roll ---

  _rollCustomFormula() {
    const input = this.el.querySelector('.dice-formula-input');
    const formula = input.value.trim();
    if (!formula) return;

    const validation = validateFormula(formula);
    if (!validation.valid) {
      // Flash the input red briefly
      input.style.borderColor = '#e74c3c';
      setTimeout(() => { input.style.borderColor = ''; }, 1500);
      return;
    }

    this._executeRoll(formula);
    input.value = '';
  }

  _executeRoll(formula, macroName = null) {
    const result = rollFormula(formula);

    // Add to local history
    this.rollHistory.unshift({
      formula: result.formula,
      macroName,
      total: result.total,
      breakdown: result.breakdown,
      timestamp: new Date(),
    });
    if (this.rollHistory.length > 20) this.rollHistory.pop();
    this._renderHistory();

    // Build chat content string
    const label = macroName ? `${macroName} (${result.formula})` : result.formula;
    const content = `rolled ${label}: ${result.breakdown}`;

    // Build roll data — backward-compatible with existing ChatPanel
    const rollData = {
      formula: result.formula,
      macroName: macroName || null,
      groups: result.groups,
      modifier: result.modifier,
      total: result.total,
      breakdown: result.breakdown,
    };

    // Add backward-compatible fields for simple rolls (single dice group, no keep)
    if (result.groups.length === 1 && !result.groups[0].keep) {
      rollData.count = result.groups[0].count;
      rollData.sides = result.groups[0].sides;
      rollData.results = result.groups[0].results;
    } else {
      // For complex rolls, use first group as fallback
      const g = result.groups[0] || { count: 1, sides: 20, results: [result.total] };
      rollData.count = g.count;
      rollData.sides = g.sides;
      rollData.results = g.kept || g.results;
    }

    // Broadcast via callback
    this.onRoll(content, null, rollData);
  }

  _renderHistory() {
    const historyEl = this.el.querySelector('.dice-history');
    if (this.rollHistory.length === 0) {
      historyEl.innerHTML = '<div class="dice-history-empty">No rolls yet</div>';
      return;
    }

    historyEl.innerHTML = this.rollHistory.map(r => {
      const time = r.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const name = r.macroName ? `<span class="dice-history-macro">${r.macroName}</span> ` : '';
      return `
        <div class="dice-history-item">
          <div class="dice-history-top">
            ${name}<span class="dice-history-formula">${r.formula}</span>
            <span class="dice-history-time">${time}</span>
          </div>
          <div class="dice-history-total">= ${r.total}</div>
        </div>
      `;
    }).join('');
  }

  // --- Macros ---

  /**
   * Set the active character and reload their macros + checks.
   * @param {number} characterId
   */
  async setActiveCharacter(characterId) {
    if (!characterId || characterId === this.activeCharacterId) return;
    this.activeCharacterId = characterId;
    this.quickChecks = this._loadChecks();
    this._renderChecks();
    await this._loadMacros();
  }

  async _loadMacros() {
    if (!this.activeCharacterId) {
      this.macros = [];
      this._renderMacros();
      return;
    }

    try {
      const data = await getMacros(this.activeCharacterId);
      this.macros = data.macros || [];
    } catch (err) {
      console.error('Failed to load macros:', err);
      this.macros = [];
    }
    this._renderMacros();
  }

  _renderMacros() {
    const listEl = this.el.querySelector('.dice-macro-list');
    const emptyEl = this.el.querySelector('.dice-macro-empty');

    if (this.macros.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }

    emptyEl.style.display = 'none';
    listEl.innerHTML = this.macros.map(m => `
      <div class="dice-macro-item" data-macro-id="${m.id}">
        <div class="dice-macro-item-main">
          <span class="dice-macro-category-badge ${m.category}">${CATEGORY_LABELS[m.category] || m.category}</span>
          <span class="dice-macro-item-name">${this._esc(m.name)}</span>
        </div>
        <div class="dice-macro-item-detail">
          <span class="dice-macro-item-formula">${this._esc(m.formula)}</span>
          ${m.description ? `<span class="dice-macro-item-desc">${this._esc(m.description)}</span>` : ''}
        </div>
        <div class="dice-macro-item-actions">
          <button class="dice-macro-edit-btn" data-macro-id="${m.id}" title="Edit">&#9998;</button>
          <button class="dice-macro-delete-btn" data-macro-id="${m.id}" title="Delete">&times;</button>
        </div>
      </div>
    `).join('');

    // Click macro to roll
    listEl.querySelectorAll('.dice-macro-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't trigger roll if clicking edit/delete buttons
        if (e.target.closest('.dice-macro-edit-btn') || e.target.closest('.dice-macro-delete-btn')) return;
        e.stopPropagation();
        const macroId = parseInt(item.dataset.macroId, 10);
        const macro = this.macros.find(m => m.id === macroId);
        if (macro) {
          this._executeRoll(macro.formula, macro.name);
        }
      });
    });

    // Edit buttons
    listEl.querySelectorAll('.dice-macro-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const macroId = parseInt(btn.dataset.macroId, 10);
        const macro = this.macros.find(m => m.id === macroId);
        if (macro) this._showMacroForm(macro);
      });
    });

    // Delete buttons
    listEl.querySelectorAll('.dice-macro-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const macroId = parseInt(btn.dataset.macroId, 10);
        this._deleteMacro(macroId);
      });
    });
  }

  _showMacroForm(existingMacro = null) {
    this.editingMacroId = existingMacro ? existingMacro.id : null;
    const form = this.el.querySelector('.dice-macro-form');
    form.style.display = '';

    const nameInput = form.querySelector('.dice-macro-name');
    const formulaInput = form.querySelector('.dice-macro-formula');
    const descInput = form.querySelector('.dice-macro-desc');
    const categorySelect = form.querySelector('.dice-macro-category');
    const errorEl = form.querySelector('.dice-macro-form-error');

    nameInput.value = existingMacro ? existingMacro.name : '';
    formulaInput.value = existingMacro ? existingMacro.formula : '';
    descInput.value = existingMacro ? (existingMacro.description || '') : '';
    categorySelect.value = existingMacro ? existingMacro.category : 'custom';
    errorEl.textContent = '';

    const saveBtn = form.querySelector('.dice-macro-save-btn');
    saveBtn.textContent = existingMacro ? 'Update' : 'Save';

    // Hide the add button
    this.el.querySelector('.dice-macro-add-btn').style.display = 'none';

    nameInput.focus();
  }

  _hideMacroForm() {
    this.editingMacroId = null;
    const form = this.el.querySelector('.dice-macro-form');
    form.style.display = 'none';
    form.querySelector('.dice-macro-form-error').textContent = '';
    this.el.querySelector('.dice-macro-add-btn').style.display = '';
  }

  async _saveMacro() {
    const form = this.el.querySelector('.dice-macro-form');
    const name = form.querySelector('.dice-macro-name').value.trim();
    const formula = form.querySelector('.dice-macro-formula').value.trim();
    const description = form.querySelector('.dice-macro-desc').value.trim();
    const category = form.querySelector('.dice-macro-category').value;
    const errorEl = form.querySelector('.dice-macro-form-error');

    if (!name) {
      errorEl.textContent = 'Name is required';
      return;
    }
    if (!formula) {
      errorEl.textContent = 'Formula is required';
      return;
    }

    const validation = validateFormula(formula);
    if (!validation.valid) {
      errorEl.textContent = validation.error;
      return;
    }

    try {
      if (this.editingMacroId) {
        await updateMacro(this.editingMacroId, { name, formula, description, category });
      } else {
        await createMacro(this.activeCharacterId, { name, formula, description, category });
      }
      this._hideMacroForm();
      await this._loadMacros();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to save macro';
    }
  }

  async _deleteMacro(macroId) {
    try {
      await deleteMacro(macroId);
      await this._loadMacros();
    } catch (err) {
      console.error('Failed to delete macro:', err);
    }
  }

  // --- Utility ---

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  destroy() {
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }
}
