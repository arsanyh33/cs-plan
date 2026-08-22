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

  /* أيقونتا الثيم — SVG رفيعتان بدل الإيموجي (شمس/قمر)، بتتبادلا بمحتوى الـ <svg> */
  const ICON_SUN = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M4.2 4.2l1.85 1.85M17.95 17.95l1.85 1.85M2.5 12h2.6M18.9 12h2.6M4.2 19.8l1.85-1.85M17.95 6.05l1.85-1.85"/>';
  const ICON_MOON = '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>';
  /* أيقونات SVG جاهزة الاستخدام لعناصر البحث (بدل 📘 🏷️ 🩺) */
  const ICON_DOC   = '<svg viewBox="0 0 24 24" class="ic-svg"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
  const ICON_TAG    = '<svg viewBox="0 0 24 24" class="ic-svg"><path d="M12.6 3.5h-4L3.5 8.6v4l9 9 5.1-5.1v-4z"/><circle cx="8.2" cy="8.2" r="1.1"/></svg>';
  const ICON_GAUGE  = '<svg viewBox="0 0 24 24" class="ic-svg"><path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l3.5-4.5"/><circle cx="12" cy="15" r="1"/></svg>';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#faf7f2' : '#05060b');
    const btn = $('#themeBtn');
    const icon = $('#themeIcon');
    if (icon) icon.innerHTML = theme === 'light' ? ICON_MOON : ICON_SUN;
    if (btn) {
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
    renderModuleGroup('#modHost', (mod) => (mod.category || 'college') === 'college');
    renderModuleGroup('#modHostGeneral', (mod) => mod.category === 'general');
  }

  function renderModuleGroup(hostSelector, filterFn) {
    const host = $(hostSelector);
    if (!host || !REG) return;
    host.innerHTML = '';

    REG.modules.filter(filterFn).forEach((mod) => {
      const s = moduleSummary(mod);
      const totalH = 132;
      const pct = s.doneHours ? Math.min(100, (s.doneHours / totalH) * 100)
                : s.doneCount ? Math.min(100, (s.doneCount / 46) * 100) : 0;

      const a = document.createElement('a');
      a.className = 'mod';
      a.href = mod.entry;
      a.style.setProperty('--c1', mod.color1 || 'var(--accent)');
      a.style.setProperty('--c2', mod.color2 || 'var(--accent2)');

      /* شارة "جديد" — تلقائيًا لو addedAt موجود وعمره أقل من 30 يوم */
      let isNew = false;
      if (mod.addedAt) {
        const addedTime = new Date(mod.addedAt).getTime();
        if (!isNaN(addedTime)) {
          const daysSince = (Date.now() - addedTime) / 86400000;
          isNew = daysSince >= 0 && daysSince <= 30;
        }
      }
      if (isNew) {
        const badge = document.createElement('span');
        badge.className = 'mod-new-badge';
        badge.textContent = '✨ جديد';
        a.appendChild(badge);
      }

      const pills = [];
      if (s.hasData) {
        if (s.doneCount)   pills.push(`<span class="pill ok">✓ <span class="mono-num">${s.doneCount}</span> مادة مخلّصة</span>`);
        if (s.doneHours)   pills.push(`<span class="pill info"><span class="mono-num">${s.doneHours} / ${totalH}</span> ساعة</span>`);
        if (s.gradedCount) pills.push(`<span class="pill"><svg viewBox="0 0 24 24" class="ic-svg"><path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M6.5 10v5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-5"/></svg> <span class="mono-num">${s.gradedCount}</span> تقدير</span>`);
        if (s.realTerms)   pills.push(`<span class="pill"><svg viewBox="0 0 24 24" class="ic-svg"><rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 3v3M16 3v3"/></svg> <span class="mono-num">${s.realTerms}</span> ترم فعلي</span>`);
      } else {
        pills.push(`<span class="pill">لسه مابدأتش — افتحها</span>`);
      }

      a.innerHTML = `
        <span class="mod-glare"></span>
        <div class="mod-top">
          <div class="mod-ic">${mod.icon || '<svg viewBox="0 0 24 24" class="ic-svg"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>'}</div>
          <div class="mod-h">
            <b>${mod.title}</b>
            <small>${(mod.tags || []).slice(0, 3).join(' • ')}</small>
          </div>
        </div>
        <p class="mod-desc">${mod.desc || ''}</p>
        ${s.hasData ? `<div class="bar" title="${Math.round(pct)}%"><i data-w="${pct}"></i></div>` : ''}
        <div class="mod-foot">${pills.join('')}<span class="mod-go">افتح <span>←</span></span></div>`;
      a.addEventListener('click', (e) => {
        if (a.classList.contains('is-loading')) { e.preventDefault(); return; }
        e.preventDefault();
        a.classList.add('is-loading');
        document.documentElement.classList.add('leaving');
        try {
          if (typeof gtag === 'function') {
            gtag('event', 'select_content', {
              content_type: 'module',
              item_id: mod.id,
              item_name: mod.title
            });
          }
        } catch (err) { /* تتبع اختياري — أي خطأ هنا ما يوقفش التنقل */ }
        setTimeout(() => { location.href = a.href; }, 220);
      });

      host.appendChild(a);
      tilt3D(a);
    });
    revealScan();
    growBars(host);
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
  /* نفس آلية ملفاتك الأصلية بالحرف — بالظبط زي applyDeviceMode في
     cs-stat/cs-special (نفس التقنية، كوبي 1:1):
     "لابتوب" بيفرض عرض الصفحة فعليًا عبر تغيير viewport meta بس — فالمتصفح
     يعامل الصفحة كأنها بعرض لابتوب حقيقي مهما كان الجهاز، وبيزوّم اوت
     تلقائيًا (بشكل أصلي من المتصفح نفسه، مش بحساب CSS يدوي) عشان كل
     التفاصيل تتناسب مع الشاشة من غير أي مساحة فاضية. "تلقائي" مابيفرضش
     حاجة أصلًا — يسيب الصفحة متجاوبة طبيعي (مهم لو أصلًا مفتوح من لابتوب
     حقيقي).

     الوضع الافتراضي عند كل فتح للصفحة (بيتحسب من واقع الشاشة الحقيقية كل
     مرة، من غير ما يتحفظ في الذاكرة خالص — نفس فكرة cs-stat/cs-special
     بالظبط): لو الشاشة فعلاً صغيرة (فون/تابلت) — بيفرض شكل اللابتوب
     بالتفاصيل كاملة تلقائيًا. لو الفتح من لابتوب/ديسكتوب حقيقي (شاشة
     كبيرة already)، بيسيبه طبيعي تمامًا. */
  const DEVICES = ['auto', 'mobile', 'tablet', 'laptop'];
  const RESPONSIVE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
  const DESKTOP_VIEWPORT = 'width=1180, viewport-fit=cover';

  /* "موبايل/تابلت" في القايمة دي أداة معاينة (Preview) لمستخدم فاتح الموقع
     من كمبيوتر/لابتوب حقيقي (بمؤشر فأرة) وعايز يشوف شكل الصفحة على فون أو
     تابلت — فبتحط الصفحة جوه فريم مصغّر بحدود وظل بيحاكي شكل الجهاز.
     لو المستخدم أصلاً فاتح الموقع من فون أو تابلت حقيقي (جهاز لمس)، مفيش
     أي داعي لمحاكاة فون جوه فون، وده اللي كان بيسبب مشكلة محتوى مصغّر
     وسط الشاشة وفراغ كبير حواليه. فبنكتشف هل الجهاز الحالي جهاز لمس حقيقي
     ولا لأ، ولو أيوه بنمنع تفعيل الفريم على وضعي Mobile/Tablet ونسيبها
     متجاوبة طبيعي زي وضع "تلقائي" بالظبط (بدون أي تصغير أو فراغ). */
  const TABLET_VIEWPORT = 'width=820, viewport-fit=cover';

  function isRealTouchDevice() {
    try { return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0; }
    catch (e) { return (navigator.maxTouchPoints || 0) > 0; }
  }

  function applyDevice(mode) {
    const m = DEVICES.indexOf(mode) >= 0 ? mode : 'auto';
    document.body.classList.remove('device-mobile', 'device-tablet', 'device-laptop', 'device-auto');

    /* الفريم المصغّر أداة معاينة لحد على شاشة كبيرة بماوس. على جهاز لمس حقيقي
       مابنستخدمهوش أبدًا — بنغيّر عرض الـ viewport والمتصفح يزوّم اوت لوحده
       (نفس ميكانيزم "موقع سطح المكتب" في المتصفح). */
    const isTouch = isRealTouchDevice();
    const framed = !isTouch && (m === 'mobile' || m === 'tablet');
    if (framed) document.body.classList.add('device-' + m);
    else if (m === 'laptop') document.body.classList.add('device-laptop');
    else document.body.classList.add('device-auto');

    let content = RESPONSIVE_VIEWPORT;
    if (m === 'laptop') content = DESKTOP_VIEWPORT;
    else if (m === 'tablet' && isTouch) content = TABLET_VIEWPORT;

    const vp = $('#viewportMeta') || document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', content);

    const sel = $('#deviceSelect');
    if (sel && sel.value !== m) sel.value = m;

    /* مزامنة تظليل البطاقة المختارة جوه مودال الـ FAB مع نفس الوضع الحالي */
    $$('.dev-btn').forEach((btn) => {
      btn.classList.toggle('dev-highlight', btn.getAttribute('data-mode') === m);
    });

    /* مفيش أي رسالة منع — كل وضع بقى بيتنفّذ فعليًا على أي جهاز. */
    return m;
  }

  function wireDevice() {
    const sel = $('#deviceSelect');

    /* الوضع الافتراضي دايمًا "تلقائي" — الصفحة الرئيسية أصلاً متجاوبة
       بالكامل (نقاط توقف مخصصة 900/640/520/420px في app.css)، فمفيش أي
       داعي لفرض حيلة "لابتوب" (width=1180) على الشاشات الصغيرة؛ الحيلة دي
       هي اللي كانت بتسبب فراغ فاضي ضخم تحت المحتوى على الفون والتابلت. */
    applyDevice('auto');

    if (sel) sel.addEventListener('change', () => {
      applyDevice(sel.value);
      global.scrollTo({ top: 0, behavior: 'smooth' });
    });

    /* ------------------- مودال الـ FAB (طريقة وصول تانية) ------------------ */
    const fab = $('#devFab');
    const overlay = $('#devModalOverlay');
    if (fab && overlay) {
      const openModal = () => {
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        const current = sel ? sel.value : 'auto';
        $$('.dev-btn').forEach((btn) => {
          btn.classList.toggle('dev-highlight', btn.getAttribute('data-mode') === current);
        });
      };
      const closeModal = () => {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
      };

      fab.addEventListener('click', openModal);
      $$('.dev-btn', overlay).forEach((btn) => {
        btn.addEventListener('click', () => {
          applyDevice(btn.getAttribute('data-mode'));
          closeModal();
          global.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      const closeBtn = $('.dev-close', overlay);
      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
      });
    }
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

  /* --------------------- قائمة الإعدادات (حجم خط/جهاز/مشاركة) -------------------- */
  function wireSettingsMenu() {
    const btn = $('#settingsBtn'), panel = $('#settingsPanel');
    if (!btn || !panel) return;
    const close = () => {
      panel.classList.remove('open'); panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      panel.hidden = false;
      requestAnimationFrame(() => panel.classList.add('open'));
      btn.setAttribute('aria-expanded', 'true');
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel.classList.contains('open')) close(); else open();
    });
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('open')) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) { close(); btn.focus(); }
    });
    /* لو اختار جهاز من القائمة، نقفل القائمة عشان يشوف النتيجة على طول */
    const sel = $('#deviceSelect');
    if (sel) sel.addEventListener('change', () => close());
  }

  /* ------------------------------- مشاركة ------------------------------- */
  function wireShare() {
    const btn = $('#shareBtn');
    if (!btn) return;
    const url = location.href.replace(/[?#].*$/, '');
    btn.addEventListener('click', () => {
      try {
        if (typeof gtag === 'function') gtag('event', 'share', { method: navigator.share ? 'web_share' : 'copy_link' });
      } catch (err) { /* تتبع اختياري */ }
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
          toast(ok ? 'اللينك اتنسخ' : 'انسخ اللينك من شريط العنوان');
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
        url: m.entry, icon: m.icon || ICON_DOC, code: '',
        hay: [m.title, m.short, m.desc, (m.tags || []).join(' ')].join(' ').toLowerCase(),
      });
      (m.tags || []).forEach((t) => {
        SEARCH_INDEX.push({
          kind: 'tag', title: t, sub: `في: ${m.title}`, url: m.entry,
          icon: ICON_TAG, code: '', hay: (t + ' ' + m.title).toLowerCase(),
        });
      });
    });
    [
      { t: 'نسخة احتياطية وتصدير البيانات', s: 'نزّل كل بياناتك ملف واحد', u: 'diagnostics.html', i: '⤓' },
      { t: 'استيراد نسخة احتياطية', s: 'رجّع بياناتك من ملف', u: 'diagnostics.html', i: '⤒' },
      { t: 'حالة التخزين والكاش', s: 'المساحة والملفات المحفوظة', u: 'diagnostics.html', i: ICON_GAUGE },
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
        ${risks.length ? `<div class="note warn" style="margin-top:14px"><b>خد بالك:</b><ul style="margin:8px 18px 0;line-height:1.9">${risks.map((r) => `<li>${r}</li>`).join('')}</ul></div>` : ''}
        <div class="btn-row" style="margin-top:16px">
          <button class="btn primary sm" id="dlBackup">⤓ نزّل نسخة احتياطية</button>
          <a class="btn ghost sm" href="diagnostics.html">🩺 التشخيص الكامل</a>
        </div>`;

      const b = $('#dlBackup');
      if (b) b.addEventListener('click', () => {
        b.disabled = true;
        global.UniStore.downloadBackup()
          .then((r) => { toast(`اتنزّلت — ${r.keys} عناصر (${(r.bytes / 1024).toFixed(1)} KB)`); renderStorage(); })
          .catch(() => toast('فشل التنزيل'))
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

  /* ------------------------------------------------------- "جديد الموقع" */
  const LAST_SEEN_VER_KEY = 'uniLastSeenVersion_v1';

  /* عشان تضيف إصدار جديد هنا في المستقبل: ضيف مفتاح برقم الـ version
     الجديد (لازم يطابق registry.json → app.version بالظبط)، وقيمته
     مصفوفة سطور — كل سطر ممكن يستخدم <b> لتمييز جزء منه. */
  const CHANGELOG = {
    '2.10.0': [
      '<b>خريطة المتطلبات التفاعلية</b> — موديول جديد بيوريك بصريًا إزاي مواد خطتك مرتبطة ببعض، ومتطلب إيه قبل إيه، لأي قسم من الثلاثة.',
      '<b>جولة تعريفية بسيطة</b> — لو دي أول مرة تزور الموقع، هنعرّفك بسرعة على أهم حاجتين فيه.',
    ],
  };

  function wireWhatsNew() {
    if (!REG || !REG.app || !REG.app.version) return;
    const cur = REG.app.version;
    let lastSeen = null;
    try { lastSeen = localStorage.getItem(LAST_SEEN_VER_KEY); } catch (e) { void e; }

    /* أول زيارة على الإطلاق: نسجّل النسخة الحالية بصمت من غير ما نزعج
       الزائر بنافذة "جديد" — الجولة التعريفية كفاية له أول مرة. */
    if (lastSeen === null) {
      try { localStorage.setItem(LAST_SEEN_VER_KEY, cur); } catch (e) { void e; }
      return;
    }
    if (lastSeen === cur) return;

    const entries = CHANGELOG[cur];
    if (!entries || !entries.length) {
      try { localStorage.setItem(LAST_SEEN_VER_KEY, cur); } catch (e) { void e; }
      return;
    }

    const overlay = $('#whatsNewOverlay');
    const list = $('#whatsNewList');
    if (!overlay || !list) return;
    list.innerHTML = entries.map((t) => `<li>${t}</li>`).join('');

    const markSeen = () => { try { localStorage.setItem(LAST_SEEN_VER_KEY, cur); } catch (e) { void e; } };
    const close = () => { overlay.classList.remove('open'); document.body.style.overflow = ''; markSeen(); };
    const closeBtn = $('#whatsNewClose');
    if (closeBtn) closeBtn.addEventListener('click', close, { once: true });

    setTimeout(() => {
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }, 500);

    global.WhatsNew = { close };
  }

  /* --------------------------------------------------------- جولة تعريفية */
  const ONBOARD_SEEN_KEY = 'uniOnboardingSeen_v1';
  const ONBOARD_STEPS = [
    { sel: '#searchInput', text: 'ابدأ من هنا لو دوّرت على أي حاجة — دوس على مادة، ترم، أو حتى ملحوظة، والبحث هيوصلك لها فورًا.' },
    { sel: '#plans', text: 'خطط قسمك الثلاثة موجودة هنا — افتح خطتك وابدأ سجّل المواد اللي خلصتها.' },
    { sel: '#settingsBtn', text: 'من هنا تقدر تكبّر الخط، تعاين الموقع بشكل جهاز تاني، أو تنزّل نسخة احتياطية من بياناتك.' },
  ];

  function wireOnboarding() {
    let seen = false;
    try { seen = localStorage.getItem(ONBOARD_SEEN_KEY) === '1'; } catch (e) { void e; }
    if (seen) return;

    const overlay = $('#onboardOverlay');
    const spot = $('#obSpot');
    const tip = $('#obTip');
    const textEl = $('#obText');
    const nextBtn = $('#obNext');
    const skipBtn = $('#obSkip');
    if (!overlay || !spot || !tip || !textEl || !nextBtn || !skipBtn) return;

    let i = 0;

    function place() {
      const step = ONBOARD_STEPS[i];
      const el = step ? $(step.sel) : null;
      if (!el) { next(); return; }
      const r = el.getBoundingClientRect();
      const pad = 8;
      spot.style.top = (r.top - pad) + 'px';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';

      textEl.textContent = step.text;
      nextBtn.textContent = (i === ONBOARD_STEPS.length - 1) ? 'تمام 👍' : 'التالي';

      const spaceBelow = global.innerHeight - r.bottom;
      const tipTop = spaceBelow > 160 ? r.bottom + 16 : Math.max(16, r.top - 150);
      let tipLeft = r.left;
      tipLeft = Math.max(16, Math.min(tipLeft, global.innerWidth - 296));
      tip.style.top = tipTop + 'px';
      tip.style.left = tipLeft + 'px';
    }

    function next() {
      i++;
      if (i >= ONBOARD_STEPS.length) { finish(); return; }
      place();
    }

    function finish() {
      overlay.setAttribute('hidden', '');
      overlay.setAttribute('aria-hidden', 'true');
      try { localStorage.setItem(ONBOARD_SEEN_KEY, '1'); } catch (e) { void e; }
    }

    nextBtn.addEventListener('click', next);
    skipBtn.addEventListener('click', finish);
    global.addEventListener('resize', () => { if (!overlay.hasAttribute('hidden')) place(); });

    setTimeout(() => {
      overlay.removeAttribute('hidden');
      overlay.removeAttribute('aria-hidden');
      place();
    }, 900);
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    tuneDevice();
    applyTheme(prefs().theme || 'dark');

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

    const fy = $('#footYear');
    if (fy) fy.textContent = String(new Date().getFullYear());

    wireAppbar();
    wireSettingsMenu();
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
      let gaT = null;
      si.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => doSearch(si.value), 130);
        if (gaT) clearTimeout(gaT);
        gaT = setTimeout(() => {
          const q = si.value.trim();
          if (q && typeof gtag === 'function') {
            try { gtag('event', 'search', { search_term: q }); } catch (err) { /* تتبع اختياري */ }
          }
        }, 800);
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
        setBoot('جاهز', 100, true);
        wireWhatsNew();
        wireOnboarding();
      })
      .catch(() => {
        const host = $('#modHost');
        if (host) host.innerHTML = '<div class="note bad">تعذّر تحميل قائمة الخطط. جرّب تحديث الصفحة.</div>';
        setBoot('جاهز', 100, true);
        wireOnboarding();
      });

    renderStorage();

    if (global.UniStore) {
      global.UniStore.restoreFromIDB().then((rec) => {
        if (rec && rec.length) {
          toast(`رجّعنا بياناتك من النسخة الاحتياطية (${rec.length} عناصر)`, 8000);
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
    setTimeout(() => { clearInterval(creep); setBoot('جاهز', 100, true); }, 2200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }

  global.UniShell = { toast, tilt3D, magnetize, playHero, setBoot, revealScan, countUp, applyFs, applyDevice, renderModules, renderOverall, renderStorage, prefs, applyTheme };
})(typeof window !== 'undefined' ? window : this);
