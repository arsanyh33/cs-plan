/* ==========================================================================
   shell.js — منطق الداشبورد الرئيسية
   بيقرأ registry.json ويبني الكروت، ويجمع ملخص تقدمك من كل الموديولات،
   ويتعامل مع التثبيت والتحديث وحالة التخزين والبحث الشامل.
   ========================================================================== */
(function (global) {
  'use strict';

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const PREFS_KEY = 'uniShellPrefs_v1';

  let REG = null;
  let deferredPrompt = null;

  /* --------------------------------------------------------------- prefs */
  function prefs(patch) {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (e) { void e; }
    if (patch) {
      p = Object.assign(p, patch);
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { void e; }
    }
    return p;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f7f8fc' : '#000000');
    const btn = $('#themeBtn');
    if (btn) {
      btn.textContent = theme === 'light' ? '🌙' : '☀️';
      btn.setAttribute('aria-label', theme === 'light' ? 'الوضع الليلي' : 'الوضع النهاري');
    }
  }

  /* ------------------------------------------------------------- device */
  function tuneDevice() {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    if (mem <= 2 || cores <= 2) document.documentElement.classList.add('weak-device', 'reduce-fx');
    if (global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.add('reduce-fx');
    }
  }

  /* ------------------------------------------------------------ network */
  function paintNet() {
    const el = $('#netDot');
    if (!el) return;
    const on = navigator.onLine;
    el.classList.toggle('off', !on);
    el.innerHTML = `<i></i><span>${on ? 'متصل' : 'بدون نت — شغال'}</span>`;
  }

  /* -------------------------------------------------- summaries reading */
  function moduleSummary(mod) {
    let sum = null;
    try { sum = JSON.parse(localStorage.getItem('uniSummary_' + mod.id) || 'null'); } catch (e) { void e; }

    /* برضو بنقرا مباشرة من مفاتيح الحفظ الأصلية كمصدر أدق */
    const direct = { doneCount: 0, gradedCount: 0, realTerms: 0, realCourses: 0, hasData: false };
    (mod.storageKeys || []).forEach((k) => {
      const obj = global.UniStore ? global.UniStore.readKey(k) : null;
      if (!obj) return;
      direct.hasData = true;
      if (obj.done && typeof obj.done === 'object') {
        direct.doneCount += Object.keys(obj.done).filter((x) => obj.done[x]).length;
      }
      if (obj.grades && typeof obj.grades === 'object') {
        direct.gradedCount += Object.keys(obj.grades).length;
      }
      if (Array.isArray(obj.terms)) {
        direct.realTerms += obj.terms.length;
        direct.realCourses += obj.terms.reduce((s, t) => s + ((t.courses && t.courses.length) || 0), 0);
      }
    });

    return {
      doneCount:   direct.doneCount   || (sum && sum.doneCount)   || 0,
      doneHours:   (sum && sum.doneHours) || 0,
      gradedCount: direct.gradedCount || (sum && sum.gradedCount) || 0,
      realTerms:   direct.realTerms   || (sum && sum.realTerms)   || 0,
      realCourses: direct.realCourses || (sum && sum.realCourses) || 0,
      totalCourses: (sum && sum.totalCourses) || null,
      totalHours:  (sum && sum.totalHours) || null,
      hasData: direct.hasData || !!(sum && (sum.doneCount || sum.realTerms)),
      visited: !!sum,
    };
  }

  /* -------------------------------------------------------- module cards */
  function renderModules() {
    const host = $('#modHost');
    if (!host || !REG) return;
    host.innerHTML = '';

    REG.modules.forEach((mod) => {
      const s = moduleSummary(mod);
      const totalH = 132;
      const pct = s.doneHours ? Math.min(100, (s.doneHours / totalH) * 100)
                : s.doneCount ? Math.min(100, (s.doneCount / 46) * 100) : 0;

      const a = document.createElement('a');
      a.className = 'mod';
      a.href = mod.entry;
      a.style.setProperty('--c1', mod.color1 || 'var(--accent)');
      a.style.setProperty('--c2', mod.color2 || 'var(--accent2)');

      const pills = [];
      if (s.hasData) {
        if (s.doneCount)   pills.push(`<span class="pill ok">✓ ${s.doneCount} مادة مخلّصة</span>`);
        if (s.doneHours)   pills.push(`<span class="pill info">${s.doneHours} / ${totalH} ساعة</span>`);
        if (s.gradedCount) pills.push(`<span class="pill">🎓 ${s.gradedCount} تقدير</span>`);
        if (s.realTerms)   pills.push(`<span class="pill">🗓️ ${s.realTerms} ترم فعلي</span>`);
      } else {
        pills.push(`<span class="pill">لسه مابدأتش — افتحها</span>`);
      }

      a.innerHTML = `
        <span class="mod-glare"></span>
        <div class="mod-top">
          <div class="mod-ic">${mod.icon || '📘'}</div>
          <div class="mod-h">
            <b>${mod.title}</b>
            <small>${(mod.tags || []).slice(0, 3).join(' • ')}</small>
          </div>
        </div>
        <p class="mod-desc">${mod.desc || ''}</p>
        ${s.hasData ? `<div class="bar" title="${Math.round(pct)}%"><i data-w="${pct}"></i></div>` : ''}
        <div class="mod-foot">${pills.join('')}<span class="mod-go">افتح <span>←</span></span></div>`;
      host.appendChild(a);
      tilt3D(a);
    });
    revealScan();
    growBars(host);
    if (document.body.classList.contains('device-laptop')) forceLaptopScale(true);
  }


  /* ==================================================================
     محرّك الحركة — 3D tilt + ظهور بالسكرول + عدّادات + شرائط
     كله vanilla، صفر مكتبات، وبيتوقف تلقائيًا على الأجهزة الضعيفة.
     ================================================================== */

  const FX_OFF = () =>
    document.documentElement.classList.contains('reduce-fx') ||
    document.documentElement.classList.contains('weak-device');

  /** ميل ثلاثي الأبعاد يتبع الماوس + لمعة */
  function tilt3D(el) {
    if (FX_OFF()) return;
    if (matchMedia('(hover:none)').matches) return;   /* اللمس: مفيش tilt */
    const MAX = 9;
    let raf = null;

    function onMove(e) {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const rx = (0.5 - py) * MAX;
        const ry = (px - 0.5) * MAX;
        el.style.transform =
          `perspective(1100px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-6px) scale(1.014)`;
      });
    }
    function onLeave() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      el.style.transform = '';
    }
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
  }

  /** ظهور العناصر مع السكرول */
  let io = null;
  function revealScan() {
    const items = $$('.rv:not(.in)');
    if (!items.length) return;
    if (FX_OFF() || !('IntersectionObserver' in global)) {
      items.forEach((el) => el.classList.add('in'));
      return;
    }
    if (!io) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    }
    items.forEach((el) => io.observe(el));
  }

  /** عدّاد رقمي تصاعدي */
  function countUp(el, target) {
    const n = Number(target);
    if (!isFinite(n) || n <= 0) { el.textContent = target; return; }
    if (FX_OFF()) { el.textContent = String(n); return; }
    const dur = Math.min(1100, 380 + n * 9);
    const t0 = performance.now();
    (function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(n * eased));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function setStat(id, val) {
    const el = $(id);
    if (!el) return;
    if (val === '—' || val == null || val === 0) { el.textContent = '—'; return; }
    countUp(el, val);
  }

  /** شرائط التقدم تكبر بعد ما تظهر */
  function growBars(scope) {
    $$('.bar > i[data-w]', scope || document).forEach((bar) => {
      const w = bar.getAttribute('data-w');
      if (FX_OFF()) { bar.style.width = w + '%'; return; }
      requestAnimationFrame(() => { setTimeout(() => { bar.style.width = w + '%'; }, 220); });
    });
  }

  /** الشريط العلوي يتغيّر مع السكرول */
  function wireAppbar() {
    const bar = $('#appbar');
    if (!bar) return;
    let last = false;
    const upd = () => {
      const on = window.scrollY > 12;
      if (on !== last) { bar.classList.toggle('stuck', on); last = on; }
    };
    upd();
    global.addEventListener('scroll', upd, { passive: true });
  }


  /* ==================================================================
     أدوات الواجهة: حجم الخط • معاينة الأجهزة • الرجوع لفوق • مشاركة
     كلها بنفس قيم ملفاتك الأصلية بالظبط.
     ================================================================== */

  /* ------------------------- حجم الخط (A− A A+) ------------------------- */
  const FS_MIN = 0.85, FS_MAX = 1.35, FS_STEP = 0.075;

  function applyFs(v) {
    const val = Math.min(FS_MAX, Math.max(FS_MIN, +Number(v).toFixed(3)));
    document.documentElement.style.setProperty('--fs-scale', val);
    prefs({ fs: val });
    return val;
  }
  function curFs() {
    const p = prefs().fs;
    return (typeof p === 'number' && p >= FS_MIN && p <= FS_MAX) ? p : 1;
  }
  function wireFontSize() {
    let fs = applyFs(curFs());
    const minus = $('#fsMinus'), reset = $('#fsReset'), plus = $('#fsPlus');
    if (minus) minus.addEventListener('click', () => { fs = applyFs(fs - FS_STEP); });
    if (reset) reset.addEventListener('click', () => { fs = applyFs(1); });
    if (plus)  plus.addEventListener('click',  () => { fs = applyFs(fs + FS_STEP); });

    /* اختصارات لوحة المفاتيح: Ctrl + / − / 0 */
    global.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); fs = applyFs(fs + FS_STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); fs = applyFs(fs - FS_STEP); }
      else if (e.key === '0') { e.preventDefault(); fs = applyFs(1); }
    });
  }

  /* --------------------- معاينة الأجهزة (Auto/Mobile/…) ------------------ */
  /* نفس آلية ملفاتك الأصلية بالحرف (applyDeviceMode في cs-stat/cs-special):
     "لابتوب" بيفرض عرض 1180px فعليًا عبر تغيير viewport meta — فالمتصفح
     يعامل الصفحة كأنها بعرض لابتوب حقيقي مهما كان الجهاز، وبيزوّم اوت
     تلقائيًا عشان كل التفاصيل تتناسب مع الشاشة. "تلقائي" مابيفرضش حاجة
     أصلًا — يسيب الصفحة متجاوبة طبيعي (مهم لو أصلًا مفتوح من لابتوب حقيقي).

     الوضع الافتراضي عند أول فتح: لو الشاشة فعلاً صغيرة (فون/تابلت) —
     بيفرض شكل اللابتوب بالتفاصيل كاملة تلقائيًا. لو الفتح من لابتوب/
     ديسكتوب حقيقي (شاشة كبيرة already)، بيسيبه طبيعي تمامًا. */
  const DEVICES = ['auto', 'mobile', 'tablet', 'laptop'];
  const RESPONSIVE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
  const DESKTOP_VIEWPORT = 'width=1180, viewport-fit=cover';

  /**
   * ضمان إضافي: تغيير viewport meta بعد تحميل الصفحة مش مضمون 100% في كل
   * المتصفحات (بعضها بيتجاهل التعديل بعد أول رسم). فبعد ما نجرّب الميتا،
   * نتحقق: لو عرض الصفحة الفعلي لسه صغير، نفرض التصغير بإحداثيات CSS
   * (transform: scale) يدويًا — ده بيشتغل 100% في كل المتصفحات لأنه
   * مش معتمد على أي سلوك اختياري من المتصفح.
   */
  function forceLaptopScale(on) {
    const body = document.body;
    if (!on) {
      body.style.width = '';
      body.style.transform = '';
      body.style.transformOrigin = '';
      document.documentElement.style.height = '';
      document.documentElement.style.overflowX = '';
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.documentElement.clientWidth >= 1150) return;   /* الميتا شغالة لوحدها */
      body.style.width = '1180px';
      body.style.transform = 'none';
      body.style.transformOrigin = 'top left';
      requestAnimationFrame(() => {
        const h = body.scrollHeight;
        const scale = Math.min(1, innerWidth / 1180);
        body.style.transform = `scale(${scale})`;
        document.documentElement.style.overflowX = 'hidden';
        document.documentElement.style.height = (h * scale) + 'px';
      });
    }));
  }

  function applyDevice(mode) {
    const m = DEVICES.indexOf(mode) >= 0 ? mode : 'auto';
    document.body.classList.remove('device-mobile', 'device-tablet', 'device-laptop');
    if (m !== 'auto') document.body.classList.add('device-' + m);

    const vp = $('#viewportMeta') || document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', m === 'laptop' ? DESKTOP_VIEWPORT : RESPONSIVE_VIEWPORT);

    if (m === 'laptop') forceLaptopScale(true);
    else forceLaptopScale(false);

    prefs({ device: m });
    const sel = $('#deviceSelect');
    if (sel && sel.value !== m) sel.value = m;
    return m;
  }

  function wireDevice() {
    /* الافتراضي دايمًا "تلقائي" — الصفحة تاخد حجم شاشة الجهاز الحقيقي.
       فرض منظور اللابتوب على الموبايل كان قرار غلط (زوّم اوت + مساحة
       فاضية تحت المحتوى) — أفضل الممارسات العالمية بتنصح بعكسه تمامًا:
       تصميم Mobile-first متجاوب حقيقي بدل تصغير شكل الديسكتوب.
       "لابتوب" فضل موجود في القائمة كخيار معاينة اختياري بس، مش افتراضي. */
    const sel = $('#deviceSelect');
    const mode = prefs().device || 'auto';
    applyDevice(mode);
    if (sel) sel.addEventListener('change', () => {
      applyDevice(sel.value);
      global.scrollTo({ top: 0, behavior: 'smooth' });
    });

    let rt = null;
    global.addEventListener('resize', () => {
      if (document.body.classList.contains('device-laptop')) {
        if (rt) clearTimeout(rt);
        rt = setTimeout(() => forceLaptopScale(true), 200);
      }
    }, { passive: true });
  }

  /* ------------------ زر الرجوع لفوق + حلقة تقدّم القراءة ---------------- */
  function wireToTop() {
    const btn = $('#toTop');
    if (!btn) return;
    let raf = null;
    function upd() {
      raf = null;
      const doc = document.documentElement;
      const max = doc.scrollHeight - innerHeight;
      const y = global.scrollY;
      btn.classList.toggle('show', y > 320);
      const pct = max > 0 ? Math.min(100, (y / max) * 100) : 0;
      btn.style.setProperty('--p', pct.toFixed(1));
    }
    global.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    global.addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    btn.addEventListener('click', () => {
      global.scrollTo({ top: 0, behavior: FX_OFF() ? 'auto' : 'smooth' });
    });
    upd();
  }

  /* ------------------------------- مشاركة ------------------------------- */
  function wireShare() {
    const btn = $('#shareBtn');
    if (!btn) return;
    const url = location.href.replace(/[?#].*$/, '');
    btn.addEventListener('click', () => {
      if (navigator.share) {
        navigator.share({
          title: 'خطتي الأكاديمية — كلية العلوم إسكندرية',
          text: 'الخطط الدراسية لقسم الرياضيات وعلوم الحاسب. افتحها من كروم أو سفاري وثبّتها على شاشتك.',
          url,
        }).catch(() => {});
        return;
      }
      if (global.UniInApp) {
        global.UniInApp.copyLink(url).then((ok) => {
          toast(ok ? '🔗 اللينك اتنسخ' : '⚠️ انسخ اللينك من شريط العنوان');
        });
      }
    });
  }

  /* ------------------- اختصار البحث: / أو Ctrl+K ------------------- */
  function wireSearchShortcut() {
    const inp = $('#searchInput');
    if (!inp) return;
    global.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); inp.focus(); inp.select(); return;
      }
      if (e.key === '/' && !typing) { e.preventDefault(); inp.focus(); }
    });
  }


  /* ==================================================================
     إصدار 2.3 — تفاعلات مستوحاة من المواقع الفائزة عالميًا
     ================================================================== */

  /** شاشة الدخول بعدّاد حقيقي مربوط بتقدّم الكاش */
  let bootPct = 0, bootDone = false;
  function setBoot(text, pct, finish) {
    const sub = $('#bootSub'), bar = $('#bootBar i'), cnt = $('#bootCount');
    if (text && sub) sub.textContent = text;
    if (pct != null) {
      bootPct = Math.max(bootPct, Math.min(100, pct));
      if (bar) bar.style.width = bootPct + '%';
      if (cnt) cnt.innerHTML = Math.round(bootPct) + '<span>%</span>';
    }
    if (finish && !bootDone) {
      bootDone = true;
      if (bar) bar.style.width = '100%';
      if (cnt) cnt.innerHTML = '100<span>%</span>';
      setTimeout(() => {
        const el = $('#boot');
        if (el) el.classList.add('done');
        playHero();
      }, 420);
    }
  }

  /** ظهور كلمات العنوان واحدة واحدة */
  function playHero() {
    const h = $('.hero-h1');
    if (h) requestAnimationFrame(() => h.classList.add('in'));
    revealScan();
  }

  /** شريط تقدّم القراءة أعلى الصفحة */
  function wireScrollProgress() {
    const el = $('#scrollProg i');
    if (!el) return;
    let raf = null;
    const upd = () => {
      raf = null;
      const d = document.documentElement;
      const max = d.scrollHeight - innerHeight;
      el.style.setProperty('--p', (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0).toFixed(2) + '%');
    };
    global.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    global.addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    upd();
  }

  /** بقعة الضوء في الخلفية بتتبع المؤشر */
  function wireSpotlight() {
    if (FX_OFF() || matchMedia('(hover:none)').matches) return;
    const spot = $('#bgSpot');
    if (!spot) return;
    document.documentElement.classList.add('has-spot');
    let raf = null, x = 50, y = 22;
    global.addEventListener('mousemove', (e) => {
      x = (e.clientX / innerWidth) * 100;
      y = (e.clientY / innerHeight) * 100;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        spot.style.setProperty('--sx', x.toFixed(1) + '%');
        spot.style.setProperty('--sy', y.toFixed(1) + '%');
      });
    }, { passive: true });
  }

  /** أزرار مغناطيسية — الزر بيتحرك ناحية المؤشر (نمط momentum hover) */
  function magnetize(el, strength) {
    if (FX_OFF() || matchMedia('(hover:none)').matches) return;
    const S = strength || 5;
    let raf = null;
    el.classList.add('mag');
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        el.style.transform = `translate(${(dx * S).toFixed(1)}px,${(dy * S).toFixed(1)}px)`;
      });
    });
    el.addEventListener('mouseleave', () => {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      el.style.transform = '';
    });
  }
  function wireMagnets() {
    $$('.icon-btn, .fs-btn, .to-top').forEach((b) => magnetize(b, 3.5));
  }

  /* ---------------------------------------------------------- overall */
  function renderOverall() {
    if (!REG) return;
    let doneCourses = 0, doneHours = 0, graded = 0, realTerms = 0, started = 0;
    REG.modules.forEach((m) => {
      const s = moduleSummary(m);
      if (s.hasData) started++;
      doneCourses += s.doneCount;
      doneHours += s.doneHours;
      graded += s.gradedCount;
      realTerms += s.realTerms;
    });
    /* قسم الأرقام اتشال من الواجهة — نسيب الدوال آمنة لو رجعت بعدين */
    setStat('#stModules', REG.modules.length);
    setStat('#stDone', doneCourses || '—');
    setStat('#stHours', doneHours || '—');
    setStat('#stGraded', graded || '—');
    void realTerms; void started;

    const hint = $('#overallHint');
    if (hint) {
      hint.textContent = started
        ? `بتتابع ${started} من ${REG.modules.length} خطة${realTerms ? ` — و${realTerms} ترم مسجّل في خطتك الفعلية` : ''}.`
        : 'افتح أي خطة تحت وابدأ تعلّم على المواد اللي خلّصتها — كل حاجة تتحفظ تلقائيًا على جهازك.';
    }
  }

  /* ------------------------------------------------------------- search */
  let SEARCH_INDEX = null;

  function buildIndex() {
    if (SEARCH_INDEX) return Promise.resolve(SEARCH_INDEX);
    SEARCH_INDEX = [];
    if (!REG) return Promise.resolve(SEARCH_INDEX);
    REG.modules.forEach((m) => {
      SEARCH_INDEX.push({
        kind: 'module', title: m.title, sub: m.desc || '',
        url: m.entry, icon: m.icon || '📘', code: '',
        hay: [m.title, m.short, m.desc, (m.tags || []).join(' ')].join(' ').toLowerCase(),
      });
      (m.tags || []).forEach((t) => {
        SEARCH_INDEX.push({
          kind: 'tag', title: t, sub: `في: ${m.title}`, url: m.entry,
          icon: '🏷️', code: '', hay: (t + ' ' + m.title).toLowerCase(),
        });
      });
    });
    [
      { t: 'تثبيت التطبيق على الشاشة', s: 'تعليمات حسب جهازك', u: 'install.html', i: '📲' },
      { t: 'نسخة احتياطية وتصدير البيانات', s: 'نزّل كل بياناتك ملف واحد', u: 'diagnostics.html', i: '⤓' },
      { t: 'استيراد نسخة احتياطية', s: 'رجّع بياناتك من ملف', u: 'diagnostics.html', i: '⤒' },
      { t: 'حالة التخزين والكاش', s: 'المساحة والملفات المحفوظة', u: 'diagnostics.html', i: '🩺' },
    ].forEach((p) => SEARCH_INDEX.push({
      kind: 'page', title: p.t, sub: p.s, url: p.u, icon: p.i, code: '',
      hay: (p.t + ' ' + p.s).toLowerCase(),
    }));
    return Promise.resolve(SEARCH_INDEX);
  }

  /* تطبيع عربي: يشيل التشكيل ويوحّد الألف والهاء/التاء المربوطة والياء */
  function norm(s) {
    return (s || '')
      .replace(/[ً-ْٰـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .toLowerCase().trim();
  }

  function doSearch(q) {
    const host = $('#searchRes');
    if (!host) return;
    const query = norm(q);
    if (query.length < 1) { host.innerHTML = ''; host.classList.add('hide'); return; }
    host.classList.remove('hide');

    buildIndex().then((idx) => {
      const terms = query.split(/\s+/).filter(Boolean);
      const hits = idx.map((item) => {
        const hay = norm(item.hay);
        let score = 0;
        terms.forEach((t) => {
          if (hay.includes(t)) score += 2;
          if (norm(item.title).startsWith(t)) score += 3;
        });
        return { item, score };
      }).filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);

      if (!hits.length) {
        host.innerHTML = `<div class="res-empty">مفيش نتائج لـ «${q}»</div>`;
        return;
      }
      host.innerHTML = hits.map(({ item }) => `
        <a class="res-item" href="${item.url}">
          <span style="font-size:1.15rem">${item.icon}</span>
          <span class="r-b"><b>${item.title}</b><span class="r-code">${item.sub}</span></span>
          <span style="color:var(--muted2)">←</span>
        </a>`).join('');
    });
  }

  /* ------------------------------------------------------------ install */
  function setupInstall() {
    const btns = [$('#installBtn'), $('#installBtn2')].filter(Boolean);
    const btn = btns[0];
    const card = $('#installCard');
    const info = global.UniInApp ? global.UniInApp.detect() : { installed: false };

    if (info.installed) {
      if (card) card.classList.add('hide');
      return;
    }

    global.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      btns.forEach((b) => { b.classList.remove('hide'); });
    });

    const doInstall = () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((c) => {
          if (c.outcome === 'accepted' && card) card.classList.add('hide');
          deferredPrompt = null;
        }).catch(() => {});
      } else {
        location.href = 'install.html';
      }
    };
    btns.forEach((b) => b.addEventListener('click', doInstall));

    global.addEventListener('appinstalled', () => {
      if (card) card.classList.add('hide');
      toast('🎉 اتثبّت! دوّر على الأيقونة على شاشتك');
    });
  }

  /* ------------------------------------------------- service worker + boot */
  function setupSW() {
    if (!('serviceWorker' in navigator)) {
      setBoot('المتصفح ده مش بيدعم الشغل بدون نت', 100, true);
      return;
    }
    if (location.protocol === 'file:') {
      setBoot('التطبيق مفتوح كملف محلي — الشغل بدون نت محتاج سيرفر', 100, true);
      return;
    }

    navigator.serviceWorker.register('sw.js', { scope: './' }).then((reg) => {
      /* تحديث متاح؟ */
      reg.addEventListener('updatefound', () => {});
      if (reg.waiting) showUpdate(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(reg);
        });
      });
      setTimeout(() => reg.update().catch(() => {}), 4000);
    }).catch(() => {
      setBoot('تعذّر تحضير الشغل بدون نت', 100, true);
    });

    navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.type === 'PRECACHE_DONE') {
        const pct = d.total ? Math.round((d.ok / d.total) * 100) : 100;
        setBoot(`جاهز — ${d.ok}/${d.total} ملف محفوظ`, pct, true);
        if (d.failed) toast(`⚠️ ${d.failed} ملف مانزلوش — افتح التطبيق بالنت تاني`, 6000);
        else toast('✅ التطبيق بقى شغال بدون نت', 4200);
      }
    });

    if (navigator.serviceWorker.controller) {
      setBoot('محفوظ ومتاح بدون نت', 100, true);
    }
  }

  function showUpdate(reg) {
    const bar = document.createElement('div');
    bar.className = 'note info';
    bar.style.cssText = 'position:fixed;inset-inline:14px;bottom:16px;z-index:9600;display:flex;gap:12px;align-items:center;flex-wrap:wrap;box-shadow:var(--shadow)';
    bar.innerHTML = `<b>🔄 فيه إصدار جديد</b>
      <span style="color:var(--muted);font-size:.85rem">بياناتك مش هتتأثر خالص.</span>
      <button class="btn sm primary" id="updNow" style="margin-inline-start:auto">حدّث الآن</button>
      <button class="btn sm ghost" id="updLater">بعدين</button>`;
    document.body.appendChild(bar);
    $('#updNow', bar).addEventListener('click', () => {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => location.reload(), 400);
    });
    $('#updLater', bar).addEventListener('click', () => bar.remove());
  }



  /* -------------------------------------------------------- storage card */
  function renderStorage() {
    if (!global.UniStore) return;
    if (!$('#storageBody')) return;      /* القسم اتشال من الواجهة */
    global.UniStore.storageStatus().then((st) => {
      const host = $('#storageBody');
      if (!host) return;
      const mb = (n) => (n == null ? '—' : (n / 1048576).toFixed(1) + ' MB');
      const info = global.UniInApp ? global.UniInApp.detect() : {};

      const risks = [];
      if (!st.localStorageOK) risks.push('<b>التخزين مقفول</b> — إنت في وضع تصفح خاص؟ تقدمك مش هيتحفظ.');
      if (!st.indexedDBOK) risks.push('النسخة الاحتياطية التلقائية مش شغالة على المتصفح ده.');
      if (st.persisted === false) risks.push('التخزين <b>مش دائم</b> — الجهاز ممكن يمسحه لو المساحة قلّت. نزّل نسخة احتياطية كل فترة.');
      if (info.isIOS) risks.push('على الآيفون، سفاري بيمسح بيانات المواقع بعد <b>7 أيام</b> عدم استخدام. النسخة الاحتياطية دي حمايتك الوحيدة.');

      const lastB = st.lastBackupAt
        ? new Date(st.lastBackupAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })
        : null;
      const daysSince = st.lastBackupAt ? Math.floor((Date.now() - st.lastBackupAt) / 86400000) : null;

      host.innerHTML = `
        <div class="kv"><span>التخزين المحلي</span><b>${st.localStorageOK ? '<span style="color:var(--green)">شغال ✓</span>' : '<span style="color:var(--rose)">مقفول ✕</span>'}</b></div>
        <div class="kv"><span>النسخة التلقائية (IndexedDB)</span><b>${st.indexedDBOK ? '<span style="color:var(--green)">شغالة ✓</span>' : '<span style="color:var(--amber)">مش متاحة</span>'}</b></div>
        <div class="kv"><span>تخزين دائم</span><b>${st.persisted === true ? '<span style="color:var(--green)">مفعّل ✓</span>' : st.persisted === false ? '<span style="color:var(--amber)">غير مضمون</span>' : '—'}</b></div>
        <div class="kv"><span>المستخدم من مساحة المتصفح</span><b>${mb(st.usage)}${st.quota ? ` من ${mb(st.quota)}` : ''}</b></div>
        <div class="kv"><span>ملفات بياناتك المحفوظة</span><b>${st.keysPresent.length} من ${st.keysPresent.length + st.keysMissing.length}</b></div>
        <div class="kv"><span>آخر نسخة احتياطية</span><b>${lastB ? `${lastB}${daysSince > 14 ? ' <span style="color:var(--amber)">(بقالها كتير!)</span>' : ''}` : '<span style="color:var(--amber)">ماعملتش ولا واحدة</span>'}</b></div>
        ${risks.length ? `<div class="note warn" style="margin-top:14px"><b>⚠️ خد بالك:</b><ul style="margin:8px 18px 0;line-height:1.9">${risks.map((r) => `<li>${r}</li>`).join('')}</ul></div>` : ''}
        <div class="btn-row" style="margin-top:16px">
          <button class="btn primary sm" id="dlBackup">⤓ نزّل نسخة احتياطية</button>
          <a class="btn ghost sm" href="diagnostics.html">🩺 التشخيص الكامل</a>
        </div>`;

      const b = $('#dlBackup');
      if (b) b.addEventListener('click', () => {
        b.disabled = true;
        global.UniStore.downloadBackup()
          .then((r) => { toast(`✅ اتنزّلت — ${r.keys} عناصر (${(r.bytes / 1024).toFixed(1)} KB)`); renderStorage(); })
          .catch(() => toast('⚠️ فشل التنزيل'))
          .then(() => { b.disabled = false; });
      });

      global.UniStore.persistRequest().catch(() => {});
    }).catch(() => {});
  }

  /* --------------------------------------------------------------- toast */
  function toast(msg, ms) {
    let host = $('#uniToastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'uniToastHost';
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = 'uni-toast';
    t.textContent = msg;
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, ms || 4200);
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    tuneDevice();
    applyTheme(prefs().theme || 'light');

    if (global.UniInApp) {
      const info = global.UniInApp.guard();
      if (info.inApp) { const el = $('#boot'); if (el) el.classList.add('done'); }
    }

    const tb = $('#themeBtn');
    if (tb) tb.addEventListener('click', () => {
      const next = (document.documentElement.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
      applyTheme(next); prefs({ theme: next });
    });

    paintNet();
    global.addEventListener('online', paintNet);
    global.addEventListener('offline', paintNet);

    wireAppbar();
    wireScrollProgress();
    wireSpotlight();
    wireMagnets();
    wireFontSize();
    wireDevice();
    wireToTop();
    wireShare();
    wireSearchShortcut();
    revealScan();

    const si = $('#searchInput');
    if (si) {
      let t = null;
      si.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => doSearch(si.value), 130);
      });
      si.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { si.value = ''; doSearch(''); si.blur(); }
      });
    }

    fetch('registry.json', { cache: 'no-cache' })
      .then((r) => r.json())
      .then((reg) => {
        REG = reg;
        const v = $('#appVer');
        if (v && reg.app) v.textContent = 'إصدار ' + reg.app.version;
        renderModules();
        renderOverall();
        revealScan();
      })
      .catch(() => {
        const host = $('#modHost');
        if (host) host.innerHTML = '<div class="note bad">تعذّر تحميل قائمة الخطط. جرّب تحديث الصفحة.</div>';
      });

    setupInstall();
    setupSW();
    renderStorage();

    if (global.UniStore) {
      global.UniStore.restoreFromIDB().then((rec) => {
        if (rec && rec.length) {
          toast(`🛟 رجّعنا بياناتك من النسخة الاحتياطية (${rec.length} عناصر)`, 8000);
          renderModules(); renderOverall(); renderStorage();
        }
      }).catch(() => {});
      global.UniStore.mirrorToIDB().catch(() => {});
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { renderModules(); renderOverall(); }
    });

    /* أمان: لو حصل أي خطأ، الشاشة الافتتاحية ماتقعدش عالقة */
    /* تقدّم تدريجي مطمئن + أمان لو حصل أي خطأ */
    let tick = 0;
    const creep = setInterval(() => {
      tick++;
      if (bootDone) { clearInterval(creep); return; }
      setBoot(null, Math.min(88, 12 + tick * 9));
    }, 260);
    setTimeout(() => { clearInterval(creep); setBoot('جاهز', 100, true); }, 5200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }

  global.UniShell = { toast, tilt3D, magnetize, playHero, setBoot, revealScan, countUp, applyFs, applyDevice, renderModules, renderOverall, renderStorage, prefs, applyTheme };
})(typeof window !== 'undefined' ? window : this);
