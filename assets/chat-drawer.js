/* ============================================================
   chat-drawer.js — التحكم في فتح/قفل لوحة شات "اسأل TCSS" الجانبية
   في الصفحة الرئيسية (index.html فقط).

   ده مجرد "غلاف" بيفتح ويقفل اللوحة بصريًا — منطق الشات نفسه (الاتصال
   بالـ Worker، الـ Streaming، تاريخ المحادثة) لسه بالكامل جوه
   assets/chat.js زي ما هو، من غير أي تعديل فيه. الملف ده بيحمّله مرة
   واحدة بس (Lazy) أول ما حد يفتح اللوحة فعليًا، مش من أول ما الصفحة
   الرئيسية تفتح — عشان ميحصلش أي استهلاك أو تركيز غير مرغوب على حقل
   الكتابة قبل ما المستخدم يطلب الشات أصلاً.
   ============================================================ */
(function () {
  "use strict";

  var fab = document.getElementById("chatFab");
  var headerBtn = document.getElementById("chatHeaderBtn");
  var overlay = document.getElementById("chatDrawerOverlay");
  var drawer = document.getElementById("chatDrawer");
  var closeBtn = document.getElementById("chatDrawerClose");

  if (!fab || !overlay || !drawer || !closeBtn) return; // أمان لو الصفحة اتغيرت مستقبلاً

  var engineLoaded = false;
  var lastFocused = null;

  function loadEngine(done) {
    if (engineLoaded) { done(); return; }
    engineLoaded = true;
    var s = document.createElement("script");
    s.src = "assets/chat.js?v=2.13.0";
    s.onload = done;
    document.body.appendChild(s);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  function open() {
    lastFocused = document.activeElement;
    overlay.classList.add("open");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    fab.setAttribute("aria-expanded", "true");
    headerBtn && headerBtn.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("chat-drawer-locked");
    document.addEventListener("keydown", onKeydown);

    loadEngine(function () {
      var input = document.getElementById("chatInput");
      if (input) setTimeout(function () { input.focus(); }, 400);
    });
  }

  function close() {
    overlay.classList.remove("open");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    fab.setAttribute("aria-expanded", "false");
    headerBtn && headerBtn.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("chat-drawer-locked");
    document.removeEventListener("keydown", onKeydown);
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function toggle() {
    if (drawer.classList.contains("open")) close(); else open();
  }

  fab.addEventListener("click", toggle);
  if (headerBtn) headerBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);

  /* نبضة جذب انتباه بسيطة حوالين الزرار العائم — أول زيارة بس، مرتين وبس */
  try {
    if (!localStorage.getItem("csChatFabSeen_v1")) {
      fab.classList.add("pulse");
      localStorage.setItem("csChatFabSeen_v1", "1");
      setTimeout(function () { fab.classList.remove("pulse"); }, 3600);
    }
  } catch (e) {}
})();
