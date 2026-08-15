/* ==========================================================================
   sw.js — Service Worker
   --------------------------------------------------------------------------
   ده اللي بيخلي التطبيق يشتغل بدون نت.
   قواعد مهمة اتّبعناها:
     • البيانات بتاعتك في localStorage/IndexedDB — الـ SW لا يلمسها إطلاقًا.
       يعني أي تحديث للتطبيق مش بيمس تقدمك.
     • التحديث مش قسري: لما ينزل إصدار جديد، بنبلّغ الصفحة وهي تسأل المستخدم.
     • الملفات الأساسية بتتحفظ كلها مقدمًا (precache) عشان أول تشغيل offline
       يبقى مضمون 100%.
   ⚠️  لما تضيف صفحة جديدة: زوّد CACHE_VERSION تحت + ضيف مسارها في PRECACHE.
   ========================================================================== */

const CACHE_VERSION = 'v2.1.3';
const CACHE_NAME = `uni-planner-${CACHE_VERSION}`;

/* الملفات اللي لازم تتحفظ عشان التطبيق يفتح بدون نت */
const PRECACHE = [
  './',
  './index.html',
  './install.html',
  './diagnostics.html',
  './offline.html',
  './registry.json',
  './manifest.webmanifest',

  './assets/app.css',
  './assets/bridge.css',
  './assets/store.js',
  './assets/inapp.js',
  './assets/bridge.js',
  './assets/shell.js',
  './assets/fonts/fonts.css',

  './modules/cs-stat/index.html',
  './modules/cs-special/index.html',

  './assets/icons/favicon.svg',
  './assets/icons/icon.svg',
  './assets/icons/maskable.svg',

];

/* ------------------------------------------------------------- INSTALL */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    /* بنحفظ كل ملف لوحده: لو ملف واحد فشل، الباقي ما يتأثرش
       (addAll بتفشل كلها لو واحد فشل — وده كان بيكسر التثبيت) */
    const results = await Promise.allSettled(
      PRECACHE.map(async (url) => {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (!res || !res.ok) throw new Error(`${url} → ${res && res.status}`);
        await cache.put(url, res);
        return url;
      })
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      console.warn('[SW] ملفات لم تُحفظ:', failed.map((f) => String(f.reason)));
    }
    /* نبلّغ الصفحات بنسبة التقدم */
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
    clientsList.forEach((c) => c.postMessage({
      type: 'PRECACHE_DONE',
      total: PRECACHE.length,
      ok: results.length - failed.length,
      failed: failed.length,
    }));
  })());
});

/* ------------------------------------------------------------ ACTIVATE */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('uni-planner-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { void e; }
    }
    await self.clients.claim();
  })());
});

/* --------------------------------------------------------------- FETCH */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* أي دومين تاني (زي فيسبوك) — نسيبه للشبكة، ومنكاشهوش */
  if (url.origin !== location.origin) return;

  /* التنقل بين الصفحات: الشبكة الأول، والكاش وقت الفشل.
     كده لو فيه تحديث بتشوفه، ولو مفيش نت بيفتح من الكاش. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        const index = await caches.match('./index.html');
        if (index) return index;
        const off = await caches.match('./offline.html');
        if (off) return off;
        return new Response(
          '<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8">' +
          '<title>بدون اتصال</title><body style="font-family:sans-serif;background:#02030b;color:#eef1fb;' +
          'display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">' +
          '<div><h1>📴 مفيش اتصال</h1><p>الصفحة دي لسه مش محفوظة. افتح التطبيق وهو متصل بالنت مرة واحدة الأول.</p></div>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
        );
      }
    })());
    return;
  }

  /* الخطوط والصور والأيقونات: الكاش الأول (بتتغير نادر) */
  if (/\.(woff2?|ttf|otf|png|jpe?g|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (e) {
        return new Response('', { status: 504, statusText: 'offline-asset-missing' });
      }
    })());
    return;
  }

  /* باقي الملفات (CSS/JS/JSON): الكاش الأول + تحديث في الخلفية */
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then((fresh) => {
      if (fresh && fresh.ok) {
        caches.open(CACHE_NAME).then((c) => c.put(req, fresh.clone())).catch(() => {});
      }
      return fresh;
    }).catch(() => null);

    if (cached) { network.catch(() => {}); return cached; }
    const fresh = await network;
    if (fresh) return fresh;
    return new Response('', { status: 504, statusText: 'offline' });
  })());
});

/* ------------------------------------------------------------ MESSAGES */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }

  if (data.type === 'CACHE_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      let bytes = 0;
      await Promise.all(keys.map(async (k) => {
        try {
          const r = await cache.match(k);
          if (r) { const b = await r.clone().blob(); bytes += b.size; }
        } catch (e) { void e; }
      }));
      const reply = {
        type: 'CACHE_STATUS_RESULT',
        version: CACHE_VERSION,
        cacheName: CACHE_NAME,
        files: keys.length,
        expected: PRECACHE.length,
        bytes,
        missing: PRECACHE.filter((p) => !keys.some((k) => k.url.endsWith(p.replace('./', '')))).length,
      };
      if (event.source) event.source.postMessage(reply);
      else (await self.clients.matchAll()).forEach((c) => c.postMessage(reply));
    })());
    return;
  }

  if (data.type === 'REFRESH_CACHE') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(PRECACHE.map(async (url) => {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && res.ok) await cache.put(url, res);
      }));
      if (event.source) event.source.postMessage({ type: 'REFRESH_DONE' });
    })());
  }
});
