/**
 * Procedural creature sprite drawing for the first-person (raycast) renderer.
 * Each creature type has a dedicated canvas drawing function that produces
 * a distinct silhouette — no image assets required.
 *
 * All draw functions share the same signature:
 *   (ctx, cx, cy, w, h, color)
 *   - ctx: CanvasRenderingContext2D
 *   - cx:  horizontal centre of the sprite on screen
 *   - cy:  vertical centre (roughly mid-height of the wall band)
 *   - w:   total sprite width budget
 *   - h:   total sprite height budget
 *   - color: fill colour for the creature body
 */

// ── Humanoid (default fallback) ──────────────────────────────────────────────

function drawHumanoid(ctx, cx, cy, w, h, color) {
  const bodyX = cx - w / 2;
  const bodyY = cy - h * 0.3;
  const bodyH = h * 0.6;

  // Body (rounded rect)
  ctx.fillStyle = color;
  ctx.beginPath();
  const r = w * 0.3;
  ctx.moveTo(bodyX + r, bodyY);
  ctx.lineTo(bodyX + w - r, bodyY);
  ctx.quadraticCurveTo(bodyX + w, bodyY, bodyX + w, bodyY + r);
  ctx.lineTo(bodyX + w, bodyY + bodyH - r);
  ctx.quadraticCurveTo(bodyX + w, bodyY + bodyH, bodyX + w - r, bodyY + bodyH);
  ctx.lineTo(bodyX + r, bodyY + bodyH);
  ctx.quadraticCurveTo(bodyX, bodyY + bodyH, bodyX, bodyY + bodyH - r);
  ctx.lineTo(bodyX, bodyY + r);
  ctx.quadraticCurveTo(bodyX, bodyY, bodyX + r, bodyY);
  ctx.closePath();
  ctx.fill();

  // Head
  const headR = w * 0.35;
  ctx.beginPath();
  ctx.arc(cx, bodyY - headR * 0.5, headR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = Math.max(1, w * 0.04);
  ctx.stroke();
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function drawSkeleton(ctx, cx, cy, w, h, color) {
  const boneWhite = '#e8e0d0';
  const boneShade = '#c8bfab';
  const dark = '#1a1a1a';

  // Skull
  const skullR = w * 0.38;
  const skullY = cy - h * 0.32;
  ctx.beginPath();
  ctx.arc(cx, skullY, skullR, 0, Math.PI * 2);
  ctx.fillStyle = boneWhite;
  ctx.fill();
  ctx.strokeStyle = boneShade;
  ctx.lineWidth = Math.max(1, w * 0.03);
  ctx.stroke();

  // Eye sockets
  const eyeR = skullR * 0.22;
  const eyeY = skullY - skullR * 0.05;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(cx - skullR * 0.3, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + skullR * 0.3, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Nose (triangle)
  ctx.beginPath();
  ctx.moveTo(cx, skullY + skullR * 0.1);
  ctx.lineTo(cx - skullR * 0.1, skullY + skullR * 0.3);
  ctx.lineTo(cx + skullR * 0.1, skullY + skullR * 0.3);
  ctx.closePath();
  ctx.fillStyle = dark;
  ctx.fill();

  // Jaw line
  ctx.beginPath();
  ctx.moveTo(cx - skullR * 0.5, skullY + skullR * 0.5);
  ctx.lineTo(cx - skullR * 0.3, skullY + skullR * 0.75);
  ctx.lineTo(cx + skullR * 0.3, skullY + skullR * 0.75);
  ctx.lineTo(cx + skullR * 0.5, skullY + skullR * 0.5);
  ctx.strokeStyle = boneShade;
  ctx.lineWidth = Math.max(1, w * 0.04);
  ctx.stroke();

  // Spine / torso
  const torsoTop = skullY + skullR * 0.7;
  const torsoBot = cy + h * 0.25;
  const torsoW = w * 0.25;
  ctx.strokeStyle = boneWhite;
  ctx.lineWidth = Math.max(2, w * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx, torsoTop);
  ctx.lineTo(cx, torsoBot);
  ctx.stroke();

  // Ribs (3 curved lines)
  for (let i = 0; i < 3; i++) {
    const ribY = torsoTop + (torsoBot - torsoTop) * (0.15 + i * 0.25);
    const ribW = torsoW * (1 - i * 0.15);
    ctx.strokeStyle = boneShade;
    ctx.lineWidth = Math.max(1, w * 0.04);
    ctx.beginPath();
    ctx.moveTo(cx - ribW, ribY);
    ctx.quadraticCurveTo(cx, ribY + h * 0.03, cx + ribW, ribY);
    ctx.stroke();
  }

  // Arms (bone lines)
  const shoulderY = torsoTop + (torsoBot - torsoTop) * 0.1;
  ctx.strokeStyle = boneWhite;
  ctx.lineWidth = Math.max(1, w * 0.05);
  // Left arm
  ctx.beginPath();
  ctx.moveTo(cx - torsoW * 0.3, shoulderY);
  ctx.lineTo(cx - w * 0.42, cy + h * 0.1);
  ctx.lineTo(cx - w * 0.35, cy + h * 0.25);
  ctx.stroke();
  // Right arm
  ctx.beginPath();
  ctx.moveTo(cx + torsoW * 0.3, shoulderY);
  ctx.lineTo(cx + w * 0.42, cy + h * 0.1);
  ctx.lineTo(cx + w * 0.35, cy + h * 0.25);
  ctx.stroke();

  // Legs
  ctx.beginPath();
  ctx.moveTo(cx, torsoBot);
  ctx.lineTo(cx - w * 0.2, cy + h * 0.48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, torsoBot);
  ctx.lineTo(cx + w * 0.2, cy + h * 0.48);
  ctx.stroke();
}

// ── Goblin ───────────────────────────────────────────────────────────────────

function drawGoblin(ctx, cx, cy, w, h, color) {
  // Hunched small body
  const bodyW = w * 0.7;
  const bodyH = h * 0.4;
  const bodyX = cx - bodyW / 2;
  const bodyY = cy - h * 0.05;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, bodyY + bodyH / 2, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Large head (oversized)
  const headR = w * 0.4;
  const headY = bodyY - headR * 0.5;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Pointed ears
  const earW = headR * 0.6;
  const earH = headR * 0.5;
  // Left ear
  ctx.beginPath();
  ctx.moveTo(cx - headR * 0.8, headY - headR * 0.2);
  ctx.lineTo(cx - headR * 0.8 - earW, headY - earH);
  ctx.lineTo(cx - headR * 0.5, headY + headR * 0.1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  // Right ear
  ctx.beginPath();
  ctx.moveTo(cx + headR * 0.8, headY - headR * 0.2);
  ctx.lineTo(cx + headR * 0.8 + earW, headY - earH);
  ctx.lineTo(cx + headR * 0.5, headY + headR * 0.1);
  ctx.closePath();
  ctx.fill();

  // Eyes (large, yellow/glowing)
  const eyeR = headR * 0.18;
  const eyeY = headY - headR * 0.05;
  ctx.fillStyle = '#ffcc00';
  ctx.beginPath();
  ctx.arc(cx - headR * 0.3, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + headR * 0.3, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(cx - headR * 0.3, eyeY, eyeR * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + headR * 0.3, eyeY, eyeR * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Wide grinning mouth
  ctx.strokeStyle = '#111';
  ctx.lineWidth = Math.max(1, w * 0.03);
  ctx.beginPath();
  ctx.arc(cx, headY + headR * 0.35, headR * 0.4, 0.1, Math.PI - 0.1);
  ctx.stroke();

  // Thin arms
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, w * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.4, bodyY + bodyH * 0.2);
  ctx.lineTo(cx - w * 0.45, cy + h * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.4, bodyY + bodyH * 0.2);
  ctx.lineTo(cx + w * 0.45, cy + h * 0.3);
  ctx.stroke();

  // Legs
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.2, bodyY + bodyH);
  ctx.lineTo(cx - w * 0.2, cy + h * 0.48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.2, bodyY + bodyH);
  ctx.lineTo(cx + w * 0.2, cy + h * 0.48);
  ctx.stroke();
}

// ── Orc ──────────────────────────────────────────────────────────────────────

function drawOrc(ctx, cx, cy, w, h, color) {
  // Large muscular body
  const bodyW = w * 0.9;
  const bodyH = h * 0.55;
  const bodyX = cx - bodyW / 2;
  const bodyY = cy - h * 0.2;

  ctx.fillStyle = color;
  ctx.beginPath();
  const br = bodyW * 0.15;
  ctx.moveTo(bodyX + br, bodyY);
  ctx.lineTo(bodyX + bodyW - br, bodyY);
  ctx.quadraticCurveTo(bodyX + bodyW, bodyY, bodyX + bodyW, bodyY + br);
  ctx.lineTo(bodyX + bodyW, bodyY + bodyH - br);
  ctx.quadraticCurveTo(bodyX + bodyW, bodyY + bodyH, bodyX + bodyW - br, bodyY + bodyH);
  ctx.lineTo(bodyX + br, bodyY + bodyH);
  ctx.quadraticCurveTo(bodyX, bodyY + bodyH, bodyX, bodyY + bodyH - br);
  ctx.lineTo(bodyX, bodyY + br);
  ctx.quadraticCurveTo(bodyX, bodyY, bodyX + br, bodyY);
  ctx.closePath();
  ctx.fill();

  // Thick neck
  ctx.fillRect(cx - w * 0.18, bodyY - h * 0.06, w * 0.36, h * 0.08);

  // Square jaw head
  const headW = w * 0.55;
  const headH = h * 0.28;
  const headX = cx - headW / 2;
  const headY = bodyY - h * 0.06 - headH;
  ctx.beginPath();
  ctx.moveTo(headX, headY + headH * 0.2);
  ctx.quadraticCurveTo(headX, headY, cx, headY);
  ctx.quadraticCurveTo(headX + headW, headY, headX + headW, headY + headH * 0.2);
  ctx.lineTo(headX + headW, headY + headH);
  ctx.lineTo(headX, headY + headH);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Brow ridge
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = Math.max(2, w * 0.05);
  ctx.beginPath();
  ctx.moveTo(headX + headW * 0.1, headY + headH * 0.35);
  ctx.lineTo(headX + headW * 0.9, headY + headH * 0.35);
  ctx.stroke();

  // Small angry eyes
  const eyeR = headW * 0.08;
  const eyeY = headY + headH * 0.4;
  ctx.fillStyle = '#cc3300';
  ctx.beginPath();
  ctx.arc(cx - headW * 0.22, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + headW * 0.22, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Tusks (pointing upward from lower jaw)
  ctx.fillStyle = '#e8e0c8';
  // Left tusk
  ctx.beginPath();
  ctx.moveTo(cx - headW * 0.2, headY + headH);
  ctx.lineTo(cx - headW * 0.25, headY + headH * 0.6);
  ctx.lineTo(cx - headW * 0.12, headY + headH);
  ctx.closePath();
  ctx.fill();
  // Right tusk
  ctx.beginPath();
  ctx.moveTo(cx + headW * 0.2, headY + headH);
  ctx.lineTo(cx + headW * 0.25, headY + headH * 0.6);
  ctx.lineTo(cx + headW * 0.12, headY + headH);
  ctx.closePath();
  ctx.fill();

  // Arms (thick)
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, w * 0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bodyX, bodyY + bodyH * 0.15);
  ctx.lineTo(cx - w * 0.5, cy + h * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bodyX + bodyW, bodyY + bodyH * 0.15);
  ctx.lineTo(cx + w * 0.5, cy + h * 0.2);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// ── Wolf ─────────────────────────────────────────────────────────────────────

function drawWolf(ctx, cx, cy, w, h, color) {
  const darkColor = 'rgba(0,0,0,0.25)';

  // Horizontal four-legged body
  const bodyW = w * 0.85;
  const bodyH = h * 0.3;
  const bodyY = cy - bodyH * 0.2;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, bodyY + bodyH / 2, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head (extending forward)
  const headR = h * 0.18;
  const headX = cx + bodyW * 0.38;
  const headY = bodyY - headR * 0.1;
  ctx.beginPath();
  ctx.ellipse(headX, headY, headR * 1.2, headR, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Snout
  ctx.beginPath();
  ctx.moveTo(headX + headR * 1.0, headY);
  ctx.lineTo(headX + headR * 1.8, headY + headR * 0.15);
  ctx.lineTo(headX + headR * 1.0, headY + headR * 0.4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  // Nose
  ctx.beginPath();
  ctx.arc(headX + headR * 1.7, headY + headR * 0.15, headR * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#111';
  ctx.fill();

  // Eye
  ctx.beginPath();
  ctx.arc(headX + headR * 0.3, headY - headR * 0.2, headR * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = '#ffcc00';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headX + headR * 0.3, headY - headR * 0.2, headR * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = '#111';
  ctx.fill();

  // Pointed ears
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(headX - headR * 0.2, headY - headR * 0.7);
  ctx.lineTo(headX - headR * 0.5, headY - headR * 1.4);
  ctx.lineTo(headX + headR * 0.1, headY - headR * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(headX + headR * 0.3, headY - headR * 0.7);
  ctx.lineTo(headX + headR * 0.1, headY - headR * 1.3);
  ctx.lineTo(headX + headR * 0.6, headY - headR * 0.6);
  ctx.closePath();
  ctx.fill();

  // Tail (curves up from rear)
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, w * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.45, bodyY + bodyH * 0.3);
  ctx.quadraticCurveTo(cx - bodyW * 0.55, bodyY - bodyH * 0.5, cx - bodyW * 0.42, bodyY - bodyH * 0.6);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Four legs
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, w * 0.07);
  // Front legs
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.25, bodyY + bodyH);
  ctx.lineTo(cx + bodyW * 0.28, cy + h * 0.48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.15, bodyY + bodyH);
  ctx.lineTo(cx + bodyW * 0.12, cy + h * 0.48);
  ctx.stroke();
  // Back legs
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.25, bodyY + bodyH);
  ctx.lineTo(cx - bodyW * 0.28, cy + h * 0.48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.15, bodyY + bodyH);
  ctx.lineTo(cx - bodyW * 0.12, cy + h * 0.48);
  ctx.stroke();
}

// ── Dragon ───────────────────────────────────────────────────────────────────

function drawDragon(ctx, cx, cy, w, h, color) {
  const darkColor = 'rgba(0,0,0,0.2)';
  const highlight = 'rgba(255,255,255,0.15)';

  // Large triangular body
  const bodyW = w * 0.6;
  const bodyH = h * 0.5;
  const bodyTop = cy - h * 0.15;
  const bodyBot = bodyTop + bodyH;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, bodyTop);
  ctx.lineTo(cx + bodyW / 2, bodyBot);
  ctx.lineTo(cx - bodyW / 2, bodyBot);
  ctx.closePath();
  ctx.fill();

  // Belly plate (lighter triangle overlay)
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.moveTo(cx, bodyTop + bodyH * 0.3);
  ctx.lineTo(cx + bodyW * 0.2, bodyBot);
  ctx.lineTo(cx - bodyW * 0.2, bodyBot);
  ctx.closePath();
  ctx.fill();

  // Long neck
  const neckTopX = cx;
  const neckTopY = bodyTop - h * 0.2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.08, bodyTop);
  ctx.lineTo(neckTopX - w * 0.05, neckTopY);
  ctx.lineTo(neckTopX + w * 0.05, neckTopY);
  ctx.lineTo(cx + w * 0.08, bodyTop);
  ctx.closePath();
  ctx.fill();

  // Angular head
  const headW = w * 0.25;
  const headH = h * 0.14;
  const headX = neckTopX;
  const headY = neckTopY - headH / 2;
  ctx.beginPath();
  ctx.moveTo(headX + headW * 0.7, headY + headH * 0.5); // snout tip
  ctx.lineTo(headX + headW * 0.2, headY);                // top
  ctx.lineTo(headX - headW * 0.4, headY);                // back top
  ctx.lineTo(headX - headW * 0.4, headY + headH);        // back bottom
  ctx.lineTo(headX + headW * 0.2, headY + headH);        // bottom
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Eye
  ctx.fillStyle = '#ff4400';
  ctx.beginPath();
  ctx.arc(headX, headY + headH * 0.35, headH * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.ellipse(headX, headY + headH * 0.35, headH * 0.06, headH * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Horns
  ctx.strokeStyle = '#c8b888';
  ctx.lineWidth = Math.max(1, w * 0.03);
  ctx.beginPath();
  ctx.moveTo(headX - headW * 0.2, headY);
  ctx.lineTo(headX - headW * 0.4, headY - headH * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(headX - headW * 0.35, headY);
  ctx.lineTo(headX - headW * 0.55, headY - headH * 0.5);
  ctx.stroke();

  // Wings (triangles extending from sides)
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha *= 0.85;
  // Left wing
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.3, bodyTop + bodyH * 0.1);
  ctx.lineTo(cx - w * 0.5, bodyTop - h * 0.2);
  ctx.lineTo(cx - w * 0.45, bodyTop + bodyH * 0.4);
  ctx.closePath();
  ctx.fill();
  // Wing membrane lines
  ctx.strokeStyle = darkColor;
  ctx.lineWidth = Math.max(1, w * 0.015);
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.3, bodyTop + bodyH * 0.15);
  ctx.lineTo(cx - w * 0.48, bodyTop - h * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.3, bodyTop + bodyH * 0.25);
  ctx.lineTo(cx - w * 0.46, bodyTop + bodyH * 0.1);
  ctx.stroke();

  // Right wing
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.3, bodyTop + bodyH * 0.1);
  ctx.lineTo(cx + w * 0.5, bodyTop - h * 0.2);
  ctx.lineTo(cx + w * 0.45, bodyTop + bodyH * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = darkColor;
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.3, bodyTop + bodyH * 0.15);
  ctx.lineTo(cx + w * 0.48, bodyTop - h * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.3, bodyTop + bodyH * 0.25);
  ctx.lineTo(cx + w * 0.46, bodyTop + bodyH * 0.1);
  ctx.stroke();

  ctx.restore(); // restore alpha from before wings

  // Tail (curving down from body base)
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, w * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, bodyBot);
  ctx.quadraticCurveTo(cx - w * 0.15, bodyBot + h * 0.12, cx - w * 0.3, bodyBot + h * 0.05);
  ctx.stroke();
  // Tail tip (spade)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.3, bodyBot + h * 0.05);
  ctx.lineTo(cx - w * 0.38, bodyBot);
  ctx.lineTo(cx - w * 0.35, bodyBot + h * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.lineCap = 'butt';

  // Clawed feet
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, w * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.2, bodyBot);
  ctx.lineTo(cx - bodyW * 0.25, cy + h * 0.48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.2, bodyBot);
  ctx.lineTo(cx + bodyW * 0.25, cy + h * 0.48);
  ctx.stroke();
}

// ── Registry & dispatcher ────────────────────────────────────────────────────

const CREATURE_REGISTRY = {
  humanoid: drawHumanoid,
  skeleton: drawSkeleton,
  goblin:   drawGoblin,
  orc:      drawOrc,
  wolf:     drawWolf,
  dragon:   drawDragon,
};

/**
 * Draw a creature sprite procedurally on the canvas.
 * Falls back to humanoid if the creature type is unknown.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} creatureType
 * @param {number} cx - screen centre X
 * @param {number} cy - screen centre Y
 * @param {number} w  - sprite width
 * @param {number} h  - sprite height
 * @param {string} color - fill colour
 */
export function drawCreature(ctx, creatureType, cx, cy, w, h, color) {
  const drawFn = CREATURE_REGISTRY[creatureType] || drawHumanoid;
  ctx.save();
  drawFn(ctx, cx, cy, w, h, color);
  ctx.restore();
}
