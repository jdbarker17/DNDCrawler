/**
 * Express server entry point.
 * Mounts API routes, WebSocket server, serves static files in production.
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import authRoutes from './routes/auth.js';
import gameRoutes from './routes/games.js';
import characterRoutes from './routes/characters.js';
import mapRoutes from './routes/maps.js';
import macroRoutes from './routes/macros.js';
import { initWebSocket } from './ws.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '16mb' })); // map data can include background images

// --- API Routes ---
app.use('/api', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api', characterRoutes);
app.use('/api/maps', mapRoutes);
app.use('/api', macroRoutes);

// --- WebSocket ---
initWebSocket(server);

// --- Serve static files in production ---
if (process.env.NODE_ENV === 'production') {
  const distPath = join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

// --- Start ---
server.listen(PORT, () => {
  console.log(`D&D Crawler server running on http://localhost:${PORT}`);
});
