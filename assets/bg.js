/* ==========================================================================
   bg.js — الخلفية الحيّة: شبكة عُقد + رموز رياضية عائمة
   --------------------------------------------------------------------------
   الفكرة: بدل كرات ملوّنة عامة، الخلفية دي عبارة عن **شبكة عُقد وحروف**
   بتتحرك وتتوصّل ببعضها — نفس فكرة خريطة المتطلبات السابقة بتاعتك،
   ودي أنسب لقسم رياضيات وعلوم حاسب من أي زخرفة تانية.

   بتتفاعل مع الماوس (العُقد بتنجذب وبتتوهّج)، وفيها رموز رياضية عائمة.
   Canvas 2D خالص — صفر مكتبات، بيشتغل بدون نت.

   الأمان على الأجهزة الضعيفة:
     • عدد العُقد بيتحسب من مساحة الشاشة
     • بيتوقف تمامًا على الأجهزة الضعيفة أو prefers-reduced-motion
     • بيوقف الرسم لما التاب يبقى مخفي (توفير بطارية)
     • بيقيس الـ FPS ويقلّل العُقد لوحده لو الجهاز اتعب
   ========================================================================== */
(function (global) {
  'use strict';

  const CFG = {
    density: 13000,      /* بكسل مربع لكل عُقدة */
    maxNodes: 78,
    minNodes: 18,
    linkDist: 148,       /* أقصى مسافة للوصل بين عُقدتين */
    speed: 0.16,
    mouseRadius: 190,
    mousePull: 0.055,
    symbols: ['∫', 'Σ', '√', 'π', 'λ', '∂', '∞', 'Δ', 'θ', 'μ', 'σ', '≈', '⊕', '∇'],
    symbolCount: 11,
    /* لونان لكل ثيم — الفاتح ألوان أعمق وأشبع عشان تتقرا على أبيض */
    palettes: {
      dark:  [[0,229,255],[139,92,246],[255,45,120],[37,230,160]],
      light: [[0,110,150],[100,55,190],[190,15,95],[10,120,80]],
    },
  };

  let cv, ctx, W = 0, H = 0, dpr = 1;
  let nodes = [], syms = [];
  let mx = -9999, my = -9999, hasMouse = false;
  let raf = null, running = false;
  let lastT = 0, fpsAcc = 0, fpsN = 0, degraded = 0;   /* 0=كامل 1=مخفّف 2=متوقف */

  /* بوابة صارمة بس على الأجهزة الضعيفة *جدًا*.
     الحماية الحقيقية هي قياس الأداء تحت (degrade على مرحلتين)،
     فمفيش داعي نقفل الشبكة على كل موبايل متوسط. */
  function tooWeak() {
    const mem = navigator.deviceMemory;
    return (typeof mem === 'number' && mem <= 1);
  }
  function reduced() {
    return global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }
  function palette() { return CFG.palettes[isLight() ? 'light' : 'dark']; }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  function makeNodes() {
    const target = Math.max(CFG.minNodes,
      Math.min(CFG.maxNodes, Math.round((W * H) / (CFG.density * dpr * dpr))));
    nodes = [];
    for (let i = 0; i < target; i++) {
      nodes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: rand(-CFG.speed, CFG.speed) * dpr,
        vy: rand(-CFG.speed, CFG.speed) * dpr,
        r: rand(1.1, 2.9) * dpr,
        ci: (Math.random() * 4) | 0,          /* رقم اللون — يتحسب من الثيم وقت الرسم */
        p: Math.random() * Math.PI * 2,      /* طور النبض */
        ps: rand(0.006, 0.017),
      });
    }
  }

  function makeSyms() {
    syms = [];
    for (let i = 0; i < CFG.symbolCount; i++) {
      syms.push({
        ch: pick(CFG.symbols),
        x: Math.random() * W,
        y: Math.random() * H,
        vy: rand(-0.09, -0.028) * dpr,
        vx: rand(-0.04, 0.04) * dpr,
        s: rand(15, 40) * dpr,
        a: rand(0.07, 0.18),
        rot: rand(-0.28, 0.28),
      });
    }
  }

  function resize() {
    dpr = Math.min(2, global.devicePixelRatio || 1);
    const w = cv.clientWidth || innerWidth;
    const h = cv.clientHeight || innerHeight;
    W = Math.round(w * dpr);
    H = Math.round(h * dpr);
    cv.width = W; cv.height = H;
    makeNodes(); makeSyms();
  }

  function step(t) {
    raf = null;
    if (!running) return;

    /* قياس الأداء — لو الجهاز اتعب نقلّل العُقد مرة واحدة */
    if (lastT) {
      const dt = t - lastT;
      fpsAcc += dt; fpsN++;
      if (fpsN >= 80) {
        const avg = fpsAcc / fpsN;      /* متوسط زمن الإطار بالمللي */
        if (avg > 24 && degraded === 0) {
          /* مرحلة 1: نقص العُقد والرموز */
          degraded = 1;
          nodes = nodes.slice(0, Math.max(CFG.minNodes, (nodes.length * 0.5) | 0));
          syms = syms.slice(0, 4);
        } else if (avg > 30 && degraded === 1) {
          /* مرحلة 2: الجهاز مش قادر — نوقف الرسم ونحوّل لخلفية ثابتة */
          degraded = 2;
          stop();
          cv.style.display = 'none';
          document.documentElement.classList.add('bg-static');
          return;
        }
        fpsAcc = 0; fpsN = 0;
      }
    }
    lastT = t;

    ctx.clearRect(0, 0, W, H);
    const light = isLight();
    const PAL = palette();
    const symTint = light ? '70,80,120' : '150,170,255';
    const symA = light ? 1.35 : 1;

    /* ---------------- الرموز الرياضية العائمة (خلف كل حاجة) ---------------- */
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of syms) {
      s.x += s.vx; s.y += s.vy;
      if (s.y < -s.s) { s.y = H + s.s; s.x = Math.random() * W; }
      if (s.x < -s.s) s.x = W + s.s;
      if (s.x > W + s.s) s.x = -s.s;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.font = `600 ${s.s}px 'Cairo', system-ui, sans-serif`;
      ctx.fillStyle = `rgba(${symTint},${(s.a * symA).toFixed(3)})`;
      ctx.fillText(s.ch, 0, 0);
      ctx.restore();
    }

    /* -------------------------- الخطوط بين العُقد -------------------------- */
    const LD = CFG.linkDist * dpr;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ca = PAL[a.ci];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const cb = PAL[b.ci];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > LD * LD) continue;
        const d = Math.sqrt(d2);
        const k = 1 - d / LD;

        /* الخطوط القريبة من الماوس تتوهّج أكتر */
        let boost = 0;
        if (hasMouse) {
          const cx = (a.x + b.x) / 2 - mx, cy = (a.y + b.y) / 2 - my;
          const md = Math.sqrt(cx * cx + cy * cy);
          const MR = CFG.mouseRadius * dpr;
          if (md < MR) boost = (1 - md / MR) * 0.5;
        }
        ctx.strokeStyle = `rgba(${ca[0]},${ca[1]},${ca[2]},${(k * (light ? 0.34 : 0.26) + boost).toFixed(3)})`;
        ctx.lineWidth = (0.6 + k * 0.7 + boost * 1.4) * dpr;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    /* ------------------------------ العُقد ------------------------------ */
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy;
      n.p += n.ps;

      /* انجذاب ناعم للماوس */
      if (hasMouse) {
        const dx = mx - n.x, dy = my - n.y;
        const d = Math.hypot(dx, dy);
        const MR = CFG.mouseRadius * dpr;
        if (d < MR && d > 0.5) {
          const f = (1 - d / MR) * CFG.mousePull;
          n.vx += (dx / d) * f;
          n.vy += (dy / d) * f;
        }
      }

      /* كبح السرعة عشان مايهربوش */
      const sp = Math.hypot(n.vx, n.vy);
      const MAXV = CFG.speed * 3.4 * dpr;
      if (sp > MAXV) { n.vx = (n.vx / sp) * MAXV; n.vy = (n.vy / sp) * MAXV; }
      n.vx *= 0.994; n.vy *= 0.994;
      if (Math.abs(n.vx) < 0.004 * dpr) n.vx += rand(-0.02, 0.02) * dpr;
      if (Math.abs(n.vy) < 0.004 * dpr) n.vy += rand(-0.02, 0.02) * dpr;

      /* ارتداد من الحدود */
      if (n.x < 0) { n.x = 0; n.vx *= -1; }
      if (n.x > W) { n.x = W; n.vx *= -1; }
      if (n.y < 0) { n.y = 0; n.vy *= -1; }
      if (n.y > H) { n.y = H; n.vy *= -1; }

      const pulse = 0.72 + Math.sin(n.p) * 0.28;
      const [r, g, b] = PAL[n.ci];

      /* هالة */
      const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 7);
      glow.addColorStop(0, `rgba(${r},${g},${b},${(light ? 0.30 : 0.42) * pulse})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 7, 0, Math.PI * 2); ctx.fill();

      /* النواة */
      ctx.fillStyle = `rgba(${r},${g},${b},${(light ? 0.86 : 0.8) * pulse + 0.2})`;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    }

    raf = requestAnimationFrame(step);
  }

  function start() {
    if (running) return;
    running = true; lastT = 0;
    raf = requestAnimationFrame(step);
  }
  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  function init() {
    cv = document.getElementById('bgCanvas');
    if (!cv) return;

    /* الأجهزة الضعيفة أو تقليل الحركة → خلفية ثابتة بدل الرسم */
    if (tooWeak() || reduced()) {
      cv.style.display = 'none';
      document.documentElement.classList.add('bg-static');
      return;
    }

    ctx = cv.getContext('2d', { alpha: true });
    if (!ctx) { cv.style.display = 'none'; document.documentElement.classList.add('bg-static'); return; }

    resize();

    let rt = null;
    global.addEventListener('resize', () => {
      if (rt) clearTimeout(rt);
      rt = setTimeout(resize, 220);
    }, { passive: true });

    /* الماوس (الكمبيوتر بس — على اللمس مفيش تفاعل عشان الأداء) */
    if (!matchMedia('(hover:none)').matches) {
      global.addEventListener('mousemove', (e) => {
        const r = cv.getBoundingClientRect();
        mx = (e.clientX - r.left) * dpr;
        my = (e.clientY - r.top) * dpr;
        hasMouse = true;
      }, { passive: true });
      global.addEventListener('mouseleave', () => { hasMouse = false; mx = my = -9999; });
    }

    /* توفير بطارية: نوقف الرسم لما التاب يبقى مخفي */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });

    /* نوقف الرسم لما الخلفية تبقى بره الشاشة (سكرول لتحت) */
    if ('IntersectionObserver' in global) {
      new IntersectionObserver((en) => {
        en.forEach((e) => { if (e.isIntersecting) start(); else stop(); });
      }, { threshold: 0 }).observe(cv);
    }

    start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else { init(); }

  global.UniBG = { start, stop, get count() { return nodes.length; } };
})(typeof window !== 'undefined' ? window : this);
