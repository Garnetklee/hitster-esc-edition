// Feuerwerk für die Siegerehrung, zeichnet auf ein Canvas über der Seite
const COLORS = ['#22e6ff', '#8a5cff', '#ff2fd1', '#ffd76a', '#3dffa8'];

export function startFireworks(canvas, ms = 6000) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const sparks = [];
  const end = performance.now() + ms;
  let nextBurst = 0;
  let last = performance.now();

  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  resize();
  addEventListener('resize', resize);
  canvas.hidden = false;

  function burst() {
    const x = canvas.width * (0.15 + Math.random() * 0.7);
    const y = canvas.height * (0.12 + Math.random() * 0.4);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    for (let i = 0; i < 70; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 220;
      sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color });
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (now < end && now >= nextBurst) { burst(); nextBurst = now + 350 + Math.random() * 450; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.vy += 140 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * 0.8;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = s.life;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (now < end || sparks.length) requestAnimationFrame(frame);
    else { canvas.hidden = true; removeEventListener('resize', resize); }
  }
  requestAnimationFrame(frame);
}
