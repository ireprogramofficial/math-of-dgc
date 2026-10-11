// Canvas drawing helpers shared by the boat slides (layout-pixel coordinates).

export const COLORS = { thrust: '#d8572a', water: '#1f6fb2', ink: '#16283d', bad: '#c0392b', good: '#2e8b57' };

/** An arrow from (x, y) by (dx, dy), with a white halo so it reads on any water color. */
export function arrow(ctx, x, y, dx, dy, color, width = 3, head = 8) {
  const len = Math.hypot(dx, dy);
  if (len < 3) return;
  const ux = dx / len, uy = dy / len, hx = x + dx, hy = y + dy;
  const draw = (w, col) => {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx - ux * head * 0.6, hy - uy * head * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.lineTo(hx - ux * head - uy * head * 0.55, hy - uy * head + ux * head * 0.55);
    ctx.lineTo(hx - ux * head + uy * head * 0.55, hy - uy * head - ux * head * 0.55);
    ctx.closePath(); ctx.fill();
  };
  draw(width + 3, 'rgba(255,255,255,0.9)');
  draw(width, color);
}

/** The boat hull, pointing along screen angle `ang` (radians, y down). */
export function boatGlyph(ctx, x, y, ang) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(13, 0); ctx.quadraticCurveTo(5, 6.5, -10, 6); ctx.lineTo(-10, -6); ctx.quadraticCurveTo(5, -6.5, 13, 0); ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(20,40,70,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
  ctx.restore();
}
