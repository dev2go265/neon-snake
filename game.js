// Neon Snake — eat food, grow, reach 200 to win. Plain canvas JS, no assets.
// MAX GRAPHICS: DPR up to 3, bloom glow, smooth interpolated movement,
// starfield + nebula layered background, trail particles, floating score
// popups, screen shake + flash on death, win confetti, auto quality scaling
// to hold 60fps on a phone (quality drops glow/particles first).
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = 600, H = 600;
  var DPR = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.scale(DPR, DPR);

  var GRID = 20, CELL = W / GRID;
  var WIN_SCORE = 200;
  var scoreEl = document.getElementById('hud-score');
  var bestEl = document.getElementById('hud-best');
  var startBtn = document.getElementById('start-btn');
  var speedInput = document.getElementById('speed');
  var speedVal = document.getElementById('speed-val');

  var state = 'title'; // title | playing | paused | won | over
  var score = 0;
  var best = 0;
  try { best = parseInt(localStorage.getItem('neon-snake-best') || '0', 10) || 0; } catch (e) { best = 0; }
  var speedMult = 1;
  try { speedMult = parseFloat(localStorage.getItem('neon-snake-speed') || '1') || 1; } catch (e) { speedMult = 1; }
  if (speedMult < 0.5) speedMult = 0.5;
  if (speedMult > 2) speedMult = 2;
  speedInput.value = String(speedMult);
  speedVal.textContent = speedMult.toFixed(1) + 'x';
  var muted = false;
  var snake = [], prevSnake = [], dir = { x: 1, y: 0 }, dirQueue = [];
  var food = null, foodsEaten = 0;
  var particles = [], popups = [];
  var acc = 0, last = 0, pulse = 0;
  var shake = 0, flash = 0, eatFlash = 0;

  // --- Auto quality: 2 = full bloom, 1 = less glow, 0 = minimal (fast) ---
  var quality = 2, slowFrames = 0, fastFrames = 0, frameEma = 16;
  function glowBlur(n) { return quality === 2 ? n : quality === 1 ? n * 0.5 : 0; }
  function maxParticles() { return quality === 2 ? 260 : quality === 1 ? 140 : 60; }

  // --- Layered background: precomputed stars + nebula blobs ---
  var stars = [], nebulas = [], i;
  for (i = 0; i < 80; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.4, tw: Math.random() * Math.PI * 2, sp: 0.5 + Math.random() * 1.5 });
  var nebColors = ['57,255,156', '76,201,240', '255,93,143', '255,209,102'];
  for (i = 0; i < 4; i++) nebulas.push({ x: Math.random() * W, y: Math.random() * H, r: 130 + Math.random() * 130, c: nebColors[i % nebColors.length], a: 0.05 + Math.random() * 0.05 });

  var audioCtx = null;
  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = vol || 0.07;
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* sound is optional */ }
  }

  function updateHud() {
    scoreEl.textContent = 'Score: ' + score;
    bestEl.textContent = 'Best: ' + best;
  }

  function snapshot() {
    prevSnake = [];
    for (var k = 0; k < snake.length; k++) prevSnake.push({ x: snake[k].x, y: snake[k].y });
  }

  function reset() {
    score = 0; foodsEaten = 0; particles = []; popups = [];
    snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    dir = { x: 1, y: 0 }; dirQueue = [];
    acc = 0; shake = 0; flash = 0; eatFlash = 0;
    snapshot();
    spawnFood();
    updateHud();
  }

  function startGame() {
    reset();
    state = 'playing';
    startBtn.textContent = 'Restart';
    beep(520, 0.12, 'square', 0.06);
  }

  function endGame(won) {
    state = won ? 'won' : 'over';
    if (score > best) {
      best = score;
      try { localStorage.setItem('neon-snake-best', String(best)); } catch (e) {}
    }
    updateHud();
    if (won) {
      for (var k = 0; k < 90; k++) burst(W / 2 + (Math.random() - 0.5) * 320, H / 2, ['#39ff9c', '#ffd166', '#ff5d8f', '#4cc9f0'][k % 4], 1);
      beep(660, 0.15, 'sine', 0.09); setTimeout(function () { beep(990, 0.25, 'sine', 0.09); }, 150);
    } else beep(140, 0.4, 'sawtooth', 0.08);
  }

  function onSnake(x, y) {
    for (var i = 0; i < snake.length; i++) if (snake[i].x === x && snake[i].y === y) return true;
    return false;
  }

  function spawnFood() {
    var x, y, guard = 0;
    do { x = Math.floor(Math.random() * GRID); y = Math.floor(Math.random() * GRID); guard++; } while (onSnake(x, y) && guard < 200);
    food = { x: x, y: y, bonus: Math.random() < 0.15 };
  }

  function burst(x, y, color, n) {
    for (var k = 0; k < n; k++) {
      if (particles.length >= maxParticles()) return;
      var a = Math.random() * Math.PI * 2;
      var sp = 60 + Math.random() * 180;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, t: 0, color: color, r: 2 + Math.random() * 3 });
    }
  }

  function popup(x, y, text, color) {
    popups.push({ x: x, y: y, text: text, color: color, t: 0, life: 0.9 });
  }

  function tickInterval() {
    var base = Math.max(62, 150 - foodsEaten * 3);
    return base / speedMult;
  }

  function step() {
    snapshot();
    if (dirQueue.length) {
      var nd = dirQueue.shift();
      if (!(nd.x === -dir.x && nd.y === -dir.y)) dir = nd;
    }
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID || onSnake(head.x, head.y)) {
      shake = 0.5; flash = 0.35;
      burst(snake[0].x * CELL + CELL / 2, snake[0].y * CELL + CELL / 2, '#ff6b6b', 24);
      endGame(false);
      return;
    }
    snake.unshift(head);
    if (food && head.x === food.x && head.y === food.y) {
      var pts = food.bonus ? 30 : 10;
      score += pts;
      foodsEaten++;
      eatFlash = 0.18;
      burst(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, food.bonus ? '#ffd166' : '#39ff9c', 18);
      popup(food.x * CELL + CELL / 2, food.y * CELL, '+' + pts, food.bonus ? '#ffd166' : '#39ff9c');
      beep(food.bonus ? 990 : 760, 0.1, 'sine', 0.07);
      spawnFood();
      updateHud();
      if (score >= WIN_SCORE) { score = WIN_SCORE; updateHud(); endGame(true); }
    } else {
      snake.pop();
      // Faint trail sparkle from the tail as it moves.
      if (quality > 0 && Math.random() < 0.35) {
        var tl = snake[snake.length - 1];
        particles.push({ x: tl.x * CELL + CELL / 2, y: tl.y * CELL + CELL / 2, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.4, t: 0, color: '#39ff9c', r: 1.5 + Math.random() * 1.5 });
      }
    }
  }

  function queueDir(x, y) {
    var lastDir = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
    if (x === -lastDir.x && y === -lastDir.y) return;
    if (x === lastDir.x && y === lastDir.y) return;
    if (dirQueue.length < 3) dirQueue.push({ x: x, y: y });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground() {
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#070722');
    grad.addColorStop(0.6, '#071a12');
    grad.addColorStop(1, '#04140c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    for (var n = 0; n < nebulas.length; n++) {
      var nb = nebulas[n];
      var rg = ctx.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r);
      rg.addColorStop(0, 'rgba(' + nb.c + ',' + nb.a + ')');
      rg.addColorStop(1, 'rgba(' + nb.c + ',0)');
      ctx.fillStyle = rg;
      ctx.fillRect(nb.x - nb.r, nb.y - nb.r, nb.r * 2, nb.r * 2);
    }
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(pulse * st.sp + st.tw));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (var g = 1; g < GRID; g++) {
      ctx.beginPath(); ctx.moveTo(g * CELL, 0); ctx.lineTo(g * CELL, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g * CELL); ctx.lineTo(W, g * CELL); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(57,255,156,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }

  // Interpolated render position for segment i (0..1 between ticks).
  function segPos(i, t) {
    var cur = snake[i];
    var prev = prevSnake[i] || prevSnake[prevSnake.length - 1] || cur;
    if (!cur) return { x: 0, y: 0 };
    // New head has no previous cell: extrapolate from its direction.
    if (!prevSnake[i] && i === 0) prev = { x: cur.x - dir.x, y: cur.y - dir.y };
    var x = prev.x + (cur.x - prev.x) * t;
    var y = prev.y + (cur.y - prev.y) * t;
    return { x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 };
  }

  function draw() {
    pulse += 0.016;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake * 2, (Math.random() - 0.5) * 10 * shake * 2);
    drawBackground();

    if (state === 'title') {
      ctx.textAlign = 'center';
      ctx.save();
      ctx.shadowColor = '#39ff9c'; ctx.shadowBlur = glowBlur(26);
      ctx.fillStyle = '#39ff9c';
      ctx.font = 'bold 46px system-ui, sans-serif';
      ctx.fillText('NEON SNAKE', W / 2, 200 + Math.sin(pulse * 1.5) * 3);
      ctx.restore();
      ctx.fillStyle = '#eef2ff';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('Eat food. Grow long. Reach 200 to win.', W / 2, 250);
      ctx.fillText('Walls and your own tail are deadly.', W / 2, 280);
      ctx.fillStyle = '#b9c4ff';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Arrows / WASD or swipe to steer', W / 2, 325);
      ctx.fillText('Enter / Space to start  •  P pause  •  M mute', W / 2, 350);
      // Animated decorative snake wave.
      for (var d = 0; d < 9; d++) {
        var dx = W / 2 - 120 + d * 30;
        var dy = 420 + Math.sin(pulse * 3 - d * 0.7) * 14;
        ctx.save();
        ctx.shadowColor = '#39ff9c'; ctx.shadowBlur = glowBlur(12);
        ctx.fillStyle = d === 0 ? '#a9ffd6' : '#39ff9c';
        ctx.beginPath(); ctx.arc(dx, dy, d === 0 ? 13 : 11, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#39ff9c';
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.fillText(best > 0 ? 'Best score: ' + best : 'Tap Play or press Enter', W / 2, 490);
      ctx.restore();
      return;
    }

    var t = state === 'playing' ? Math.min(1, acc / tickInterval()) : 1;

    // Food: pulsing orb + expanding ring + sparkle.
    if (food) {
      var fx = food.x * CELL + CELL / 2, fy = food.y * CELL + CELL / 2;
      var pr = CELL * 0.32 + Math.sin(pulse * 4) * 2;
      ctx.save();
      ctx.strokeStyle = food.bonus ? 'rgba(255,209,102,0.6)' : 'rgba(255,93,143,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fx, fy, pr + 8 + Math.sin(pulse * 4) * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowColor = food.bonus ? '#ffd166' : '#ff5d8f';
      ctx.shadowBlur = glowBlur(18);
      ctx.fillStyle = food.bonus ? '#ffd166' : '#ff5d8f';
      ctx.beginPath(); ctx.arc(fx, fy, pr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(fx - pr * 0.3, fy - pr * 0.3, pr * 0.25, 0, Math.PI * 2); ctx.fill();
    }

    // Snake: smooth interpolated, glowing gradient, head brightest.
    ctx.save();
    ctx.shadowColor = '#39ff9c';
    ctx.shadowBlur = glowBlur(14);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var i = snake.length - 1; i >= 0; i--) {
      var pos = segPos(i, t);
      var tt = snake.length <= 1 ? 0 : i / (snake.length - 1);
      var green = Math.floor(255 - tt * 90), blue = Math.floor(156 - tt * 60);
      ctx.fillStyle = 'rgb(57,' + green + ',' + blue + ')';
      var rad = (i === 0 ? CELL * 0.46 : CELL * 0.4);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, rad, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // Head highlight + eyes (interpolated position).
    var hp = segPos(0, t);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(hp.x - dir.x * 4, hp.y - dir.y * 4, CELL * 0.3, 0, Math.PI * 2); ctx.fill();
    var ex = dir.x * 6, ey = dir.y * 6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(hp.x + ex - dir.y * 6, hp.y + ey - dir.x * 6, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hp.x + ex + dir.y * 6, hp.y + ey + dir.x * 6, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#06130c';
    ctx.beginPath(); ctx.arc(hp.x + ex - dir.y * 6 + dir.x * 1.5, hp.y + ey - dir.x * 6 + dir.y * 1.5, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hp.x + ex + dir.y * 6 + dir.x * 1.5, hp.y + ey + dir.x * 6 + dir.y * 1.5, 1.8, 0, Math.PI * 2); ctx.fill();

    // Particles.
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating score popups.
    ctx.textAlign = 'center';
    for (var u = 0; u < popups.length; u++) {
      var pp = popups[u];
      ctx.globalAlpha = Math.max(0, 1 - pp.t / pp.life);
      ctx.fillStyle = pp.color;
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.fillText(pp.text, pp.x, pp.y - pp.t * 46);
    }
    ctx.globalAlpha = 1;

    // Progress bar with glow.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(14, 14, W - 28, 8, 4); ctx.fill();
    ctx.save();
    ctx.shadowColor = '#39ff9c'; ctx.shadowBlur = glowBlur(8);
    ctx.fillStyle = '#39ff9c';
    roundRect(14, 14, (W - 28) * Math.min(1, score / WIN_SCORE), 8, 4); ctx.fill();
    ctx.restore();

    if (eatFlash > 0) {
      ctx.fillStyle = 'rgba(57,255,156,' + (eatFlash * 0.7) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + (flash * 0.8) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'paused' || state === 'won' || state === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      if (state === 'paused') {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px system-ui, sans-serif';
        ctx.fillText('PAUSED', W / 2, 290);
        ctx.fillStyle = '#b9c4ff';
        ctx.font = '17px system-ui, sans-serif';
        ctx.fillText('Press P to keep slithering', W / 2, 330);
      } else if (state === 'won') {
        ctx.save();
        ctx.shadowColor = '#39ff9c'; ctx.shadowBlur = glowBlur(24);
        ctx.fillStyle = '#39ff9c';
        ctx.font = 'bold 44px system-ui, sans-serif';
        ctx.fillText('YOU WIN!', W / 2, 270);
        ctx.restore();
        ctx.fillStyle = '#ffffff';
        ctx.font = '19px system-ui, sans-serif';
        ctx.fillText('200 points. The snake is a legend.', W / 2, 315);
        ctx.fillStyle = '#b9c4ff';
        ctx.font = '17px system-ui, sans-serif';
        ctx.fillText('Score: ' + score + '   •   Best: ' + best, W / 2, 350);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Press Enter or tap Play to go again', W / 2, 385);
      } else {
        ctx.fillStyle = '#ff6b6b';
        ctx.font = 'bold 42px system-ui, sans-serif';
        ctx.fillText('GAME OVER', W / 2, 270);
        ctx.fillStyle = '#ffffff';
        ctx.font = '19px system-ui, sans-serif';
        ctx.fillText('Score: ' + score + '   •   Best: ' + best, W / 2, 315);
        ctx.fillStyle = '#ffffff';
        ctx.font = '17px system-ui, sans-serif';
        ctx.fillText('Press Enter or tap Play to try again', W / 2, 350);
      }
    }
    ctx.restore();
  }

  function loop(ts) {
    var dt = ts - last;
    last = ts;
    if (dt > 250) dt = 250;
    if (dt < 0) dt = 16;
    frameEma = frameEma * 0.95 + dt * 0.05;
    if (frameEma > 20) { slowFrames++; fastFrames = 0; } else if (frameEma < 13) { fastFrames++; slowFrames = 0; } else { slowFrames = 0; fastFrames = 0; }
    if (slowFrames > 90 && quality > 0) { quality--; slowFrames = 0; }
    if (fastFrames > 600 && quality < 2) { quality++; fastFrames = 0; }
    if (shake > 0) shake -= dt / 1000;
    if (flash > 0) flash -= dt / 1000;
    if (eatFlash > 0) eatFlash -= dt / 1000;
    if (state === 'playing') {
      acc += dt;
      var interval = tickInterval();
      while (acc >= interval && state === 'playing') { acc -= interval; step(); }
    }
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.t += dt / 1000;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      if (p.t >= p.life) particles.splice(i, 1);
    }
    for (var j = popups.length - 1; j >= 0; j--) {
      popups[j].t += dt / 1000;
      if (popups[j].t >= popups[j].life) popups.splice(j, 1);
    }
    draw();
    requestAnimationFrame(loop);
  }

  // Keyboard.
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { queueDir(0, -1); e.preventDefault(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { queueDir(0, 1); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { queueDir(-1, 0); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { queueDir(1, 0); e.preventDefault(); }
    else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (state === 'title' || state === 'won' || state === 'over') startGame();
    }
    else if (k === 'p' || k === 'P') {
      if (state === 'playing' || state === 'paused') state = state === 'playing' ? 'paused' : 'playing';
    }
    else if (k === 'm' || k === 'M') muted = !muted;
  });

  // Swipe / drag steering (touch + mouse).
  var sx = 0, sy = 0, tracking = false;
  function startTrack(x, y) { sx = x; sy = y; tracking = true; }
  function endTrack(x, y) {
    if (!tracking) return;
    tracking = false;
    var dx = x - sx, dy = y - sy;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) {
      if (state === 'title' || state === 'won' || state === 'over') startGame();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) queueDir(dx > 0 ? 1 : -1, 0);
    else queueDir(0, dy > 0 ? 1 : -1);
  }
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = e.changedTouches[0];
    startTrack(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    var t = e.changedTouches[0];
    endTrack(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('mousedown', function (e) { startTrack(e.clientX, e.clientY); });
  canvas.addEventListener('mouseup', function (e) { endTrack(e.clientX, e.clientY); });

  speedInput.addEventListener('input', function () {
    speedMult = parseFloat(speedInput.value) || 1;
    speedVal.textContent = speedMult.toFixed(1) + 'x';
    try { localStorage.setItem('neon-snake-speed', String(speedMult)); } catch (e) {}
  });

  startBtn.addEventListener('click', function () { startGame(); });

  reset();
  state = 'title';
  updateHud();
  requestAnimationFrame(loop);
})();
