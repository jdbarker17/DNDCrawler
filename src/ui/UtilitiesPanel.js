/**
 * Utilities panel – collapsible left-side panel with measurement and other tools.
 * Available to all users (players and DM).
 */

export class UtilitiesPanel {
  /**
   * @param {HTMLElement} container – DOM element to mount into
   * @param {(active: boolean) => void} onMeasureToggle – callback when measure tool is toggled
   */
  constructor(container, onMeasureToggle) {
    this.container = container;
    this.onMeasureToggle = onMeasureToggle;
    this.measureActive = false;
    this._collapsed = true;

    this._buildUI();
  }

  _buildUI() {
    this.panel = document.createElement('div');
    this.panel.id = 'utilities-panel';
    this.panel.innerHTML = `
      <button class="utilities-toggle" id="utilities-toggle">
        <span class="utilities-toggle-label">Utilities</span>
        <span class="utilities-toggle-arrow" id="utilities-arrow">&#x25B2;</span>
      </button>
      <div class="utilities-body" id="utilities-body" style="display:none">
        <button class="utilities-tool-btn" id="measure-btn">
          <span class="utilities-tool-icon">\u{1F4CF}</span>
          <span>Measure</span>
        </button>
      </div>
    `;
    this.container.appendChild(this.panel);

    // Toggle collapse
    this.panel.querySelector('#utilities-toggle').addEventListener('click', () => {
      this._collapsed = !this._collapsed;
      this.panel.querySelector('#utilities-body').style.display =
        this._collapsed ? 'none' : 'block';
      this.panel.querySelector('#utilities-arrow').textContent =
        this._collapsed ? '\u25B2' : '\u25BC';
    });

    // Measure button toggle
    this.panel.querySelector('#measure-btn').addEventListener('click', () => {
      this.measureActive = !this.measureActive;
      this.panel.querySelector('#measure-btn').classList.toggle('active', this.measureActive);
      if (this.onMeasureToggle) this.onMeasureToggle(this.measureActive);
    });
  }

  /** Programmatically set the measure tool state. */
  setMeasureActive(active) {
    this.measureActive = active;
    if (this.panel) {
      this.panel.querySelector('#measure-btn').classList.toggle('active', active);
    }
  }

  destroy() {
    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }
  }
}
