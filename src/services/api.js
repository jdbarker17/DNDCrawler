/**
 * Frontend API service.
 * Wraps fetch with JWT token management and typed API methods.
 */

const TOKEN_KEY = 'dnd_token';

// --- Token management ---

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Decode the JWT payload (without verification – the server does that).
 * Returns { id, username, iat, exp } or null.
 */
export function getCurrentUser() {
  const token = getToken();
  if (!token) return null;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearToken();
      return null;
    }
    return { id: payload.id, username: payload.username };
  } catch {
    clearToken();
    return null;
  }
}

// --- Fetch wrapper ---

async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 || res.status === 403) {
    clearToken();
    // Trigger re-render to show login screen
    window.dispatchEvent(new CustomEvent('auth-expired'));
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

// --- Auth ---

export async function register(username, password) {
  const data = await apiFetch('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.user;
}

export async function login(username, password) {
  const data = await apiFetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.user;
}

export function logout() {
  clearToken();
}

// --- Games ---

export async function getGames() {
  return apiFetch('/api/games');
}

export async function createGame(name) {
  return apiFetch('/api/games', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function joinGame(gameId) {
  return apiFetch(`/api/games/${gameId}/join`, {
    method: 'POST',
  });
}

export async function getGameState(gameId) {
  return apiFetch(`/api/games/${gameId}`);
}

export async function saveMapData(gameId, mapData) {
  return apiFetch(`/api/games/${gameId}/map`, {
    method: 'PUT',
    body: JSON.stringify({ map_data: mapData }),
  });
}

// --- Characters ---

export async function createCharacter(gameId, charData) {
  return apiFetch(`/api/games/${gameId}/characters`, {
    method: 'POST',
    body: JSON.stringify(charData),
  });
}

export async function updateCharacter(charId, data) {
  return apiFetch(`/api/characters/${charId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteCharacter(charId) {
  return apiFetch(`/api/characters/${charId}`, {
    method: 'DELETE',
  });
}

// --- Messages ---

export async function getMessages(gameId) {
  return apiFetch(`/api/games/${gameId}/messages`);
}

// --- Saved Maps (Library) ---

export async function getSavedMaps() {
  return apiFetch('/api/maps');
}

export async function createSavedMap(name, mapData) {
  return apiFetch('/api/maps', {
    method: 'POST',
    body: JSON.stringify({ name, map_data: mapData }),
  });
}

export async function getSavedMap(mapId) {
  return apiFetch(`/api/maps/${mapId}`);
}

export async function updateSavedMap(mapId, data) {
  return apiFetch(`/api/maps/${mapId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteSavedMap(mapId) {
  return apiFetch(`/api/maps/${mapId}`, {
    method: 'DELETE',
  });
}
