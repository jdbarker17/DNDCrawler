/**
 * Auth screen – login / register overlay.
 * Shown when the user is not logged in.
 */

import { login, register } from '../services/api.js';

export class AuthScreen {
  /**
   * @param {HTMLElement} container – element to mount the overlay into
   * @param {Function} onAuth – callback({ id, username }) when auth succeeds
   */
  constructor(container, onAuth) {
    this.container = container;
    this.onAuth = onAuth;
    this.mode = 'login'; // 'login' | 'register'
    this._build();
  }

  _build() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'auth-overlay';
    this.overlay.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">D&D Crawler</div>
        <div class="auth-tabs">
          <button class="auth-tab active" data-mode="login">Login</button>
          <button class="auth-tab" data-mode="register">Register</button>
        </div>
        <form class="auth-form" id="auth-form">
          <input type="text" id="auth-username" placeholder="Username" autocomplete="username" maxlength="30" required />
          <input type="password" id="auth-password" placeholder="Password" autocomplete="current-password" minlength="4" required />
          <div class="auth-error" id="auth-error"></div>
          <button type="submit" class="auth-submit" id="auth-submit">Login</button>
        </form>
      </div>
    `;
    this.container.appendChild(this.overlay);

    // Tab switching
    this.overlay.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.mode = tab.dataset.mode;
        this.overlay.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.overlay.querySelector('#auth-submit').textContent =
          this.mode === 'login' ? 'Login' : 'Create Account';
        this.overlay.querySelector('#auth-password').autocomplete =
          this.mode === 'login' ? 'current-password' : 'new-password';
        this._clearError();
      });
    });

    // Form submit
    this.overlay.querySelector('#auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit();
    });
  }

  async _submit() {
    const username = this.overlay.querySelector('#auth-username').value.trim();
    const password = this.overlay.querySelector('#auth-password').value;
    const btn = this.overlay.querySelector('#auth-submit');

    if (!username || !password) {
      this._showError('Please fill in all fields');
      return;
    }

    btn.disabled = true;
    btn.textContent = this.mode === 'login' ? 'Logging in...' : 'Creating account...';
    this._clearError();

    try {
      const user = this.mode === 'login'
        ? await login(username, password)
        : await register(username, password);

      this.onAuth(user);
    } catch (err) {
      this._showError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = this.mode === 'login' ? 'Login' : 'Create Account';
    }
  }

  _showError(msg) {
    this.overlay.querySelector('#auth-error').textContent = msg;
  }

  _clearError() {
    this.overlay.querySelector('#auth-error').textContent = '';
  }

  show() {
    this.overlay.style.display = 'flex';
  }

  hide() {
    this.overlay.style.display = 'none';
  }

  destroy() {
    this.overlay.remove();
  }
}
