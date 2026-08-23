/* ============================================================
   TCSS Chatbot — صفحة مستقلة (chat.html)
   بيرد على أسئلة الطلبة عن الخطط الدراسية بناءً على بيانات الموقع
   الفعلية (assets/kb.json)، عن طريق Cloudflare Worker وسيط بيحمي
   مفتاح الـ API. الرد بييجي Streaming (كلمة كلمة) من الـ Worker،
   ومعروض بتنسيق Markdown-lite (Bold، نقط، عناوين بسيطة).
   ============================================================ */
(function () {
  "use strict";

  var WORKER_URL = "https://tcss-chatbot.arsanyh33.workers.dev/";

  var MAX_STORED_HISTORY = 20;
  var STORAGE_KEY = "csChatHistory_v1";

  var history = []; // {role:'user'|'assistant', text:''}
  var isSending = false;

  var messagesEl = document.getElementById("chatMessages");
  var suggestionsEl = document.getElementById("chatSuggestions");
  var formEl = document.getElementById("chatForm");
  var inputEl = document.getElementById("chatInput");
  var sendBtn = document.getElementById("chatSendBtn");
  var clearBtn = document.getElementById("chatClearBtn");

  /* ---------- Markdown-lite renderer (آمن — بيعمل escape الأول) ---------- */
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function inlineMd(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/`([^`]+?)`/g, "<code>$1</code>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }
  function mdLiteToHtml(raw) {
    var text = escapeHtml(raw || "");
    var blocks = text.split(/\n{2,}/);
    var html = blocks.map(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.length; });
      if (!lines.length) return "";

      var bulletRe = /^\s*[-*•]\s+/;
      var numberRe = /^\s*\d+[.)]\s+/;
      var headingMatch = lines.length === 1 && lines[0].match(/^(#{1,4})\s+(.*)$/);

      if (lines.every(function (l) { return bulletRe.test(l); })) {
        return "<ul>" + lines.map(function (l) {
          return "<li>" + inlineMd(l.replace(bulletRe, "")) + "</li>";
        }).join("") + "</ul>";
      }
      if (lines.every(function (l) { return numberRe.test(l); })) {
        return "<ol>" + lines.map(function (l) {
          return "<li>" + inlineMd(l.replace(numberRe, "")) + "</li>";
        }).join("") + "</ol>";
      }
      if (headingMatch) {
        var level = Math.min(headingMatch[1].length + 2, 5);
        return "<h" + level + ">" + inlineMd(headingMatch[2]) + "</h" + level + ">";
      }
      return "<p>" + lines.map(inlineMd).join("<br>") + "</p>";
    }).join("");
    return html;
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function scrollToEnd() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addUserMessage(text) {
    messagesEl.appendChild(el("div", { class: "chat-msg user" }, [document.createTextNode(text)]));
    scrollToEnd();
  }
  function createBotBubble(isError) {
    var cls = "chat-msg bot" + (isError ? " error" : "");
    var bubble = el("div", { class: cls });
    messagesEl.appendChild(bubble);
    scrollToEnd();
    return bubble;
  }
  function setBotBubbleText(bubble, text, streaming) {
    bubble.innerHTML = mdLiteToHtml(text) + (streaming ? '<span class="chat-cursor">▌</span>' : "");
    scrollToEnd();
  }
  function addBotMessage(text, isError) {
    var bubble = createBotBubble(isError);
    setBotBubbleText(bubble, text, false);
  }
  function addTyping() {
    var t = el("div", { class: "chat-msg bot typing", id: "chatTyping" }, [
      el("span"), el("span"), el("span")
    ]);
    messagesEl.appendChild(t);
    scrollToEnd();
  }
  function removeTyping() {
    var t = document.getElementById("chatTyping");
    if (t) t.remove();
  }

  function hideSuggestions() {
    suggestionsEl.classList.add("hidden");
  }

  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch (e) {}
  }

  function greet() {
    addBotMessage("أهلاً! 👋 أنا مساعد TCSS، اسألني عن أي حاجة في خطتك الدراسية — الساعات، المتطلبات السابقة، شروط السبيشيال، التحويل، أو المعدل والإنذار.");
  }

  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 130) + "px";
  }
  inputEl.addEventListener("input", autoGrow);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  Array.prototype.forEach.call(suggestionsEl.querySelectorAll("button"), function (btn) {
    btn.addEventListener("click", function () {
      inputEl.value = btn.textContent;
      formEl.requestSubmit();
    });
  });

  clearBtn.addEventListener("click", function () {
    history = [];
    saveHistory();
    messagesEl.innerHTML = "";
    suggestionsEl.classList.remove("hidden");
    greet();
    inputEl.focus();
  });

  formEl.addEventListener("submit", function (e) {
    e.preventDefault();
    send();
  });

  async function send() {
    var text = inputEl.value.trim();
    if (!text || isSending) return;

    hideSuggestions();
    isSending = true;
    sendBtn.disabled = true;
    addUserMessage(text);
    history.push({ role: "user", text: text });
    saveHistory();
    inputEl.value = "";
    autoGrow();
    addTyping();

    var accumulated = "";
    var bubble = null;
    var gotAnyChunk = false;

    try {
      var res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.slice(-MAX_STORED_HISTORY)
        })
      });

      if (!res.ok || !res.body) throw new Error("bad status " + res.status);

      // قراءة الرد كـ Stream (Server-Sent Events) بدل ما ننتظر الرد كامل
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        var lines = buffer.split("\n");
        buffer = lines.pop(); // آخر سطر ممكن يكون ناقص، نسيبه للـ chunk الجاي

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.slice(0, 5) !== "data:") continue;
          var jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          var obj;
          try { obj = JSON.parse(jsonStr); } catch (e) { continue; }

          if (obj.delta) {
            if (!gotAnyChunk) {
              removeTyping();
              bubble = createBotBubble(false);
              gotAnyChunk = true;
            }
            accumulated += obj.delta;
            setBotBubbleText(bubble, accumulated, true);
          }
        }
      }

      removeTyping();

      if (!gotAnyChunk || !accumulated.trim()) {
        addBotMessage("معلش، مقدرتش أفهم رد الخادم. جرّب تسأل تاني.", true);
      } else {
        setBotBubbleText(bubble, accumulated, false); // شيل مؤشر الكتابة النهائي
        history.push({ role: "assistant", text: accumulated });
        saveHistory();
      }
    } catch (err) {
      removeTyping();
      if (bubble && accumulated) {
        // اتقطع الاتصال في نص الرد — سيب اللي وصل وبس شيل مؤشر الكتابة
        setBotBubbleText(bubble, accumulated, false);
        history.push({ role: "assistant", text: accumulated });
        saveHistory();
      } else {
        addBotMessage("معلش، حصلت مشكلة في الاتصال 🙏 اتأكد إن النت شغال وجرّب تاني كمان شوية.", true);
      }
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  function init() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved) && saved.length) {
        history = saved;
        hideSuggestions();
        history.forEach(function (m) {
          if (m.role === "user") addUserMessage(m.text);
          else addBotMessage(m.text);
        });
      } else {
        greet();
      }
    } catch (e) {
      greet();
    }
    inputEl.focus();
  }

  init();
})();
