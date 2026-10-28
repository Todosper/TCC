// ============================================================
// Scripts gerais do site — sem dependências externas.
// ============================================================

// Ícones usados por main.js e accessibility.js (globais de propósito).
var MOON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
var SUN_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
var EYE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
var EYE_OFF_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

(function () {
  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

  // ── Menu mobile ──────────────────────────────────────────────────────
  var mobileToggle = document.getElementById("mobile-menu-toggle");
  var mobileMenu = document.getElementById("mobile-menu");

  function setMobileMenu(open, returnFocus) {
    if (!mobileToggle || !mobileMenu) return;
    mobileMenu.classList.toggle("open", open);
    mobileToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open && returnFocus) mobileToggle.focus();
  }

  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener("click", function () {
      setMobileMenu(!mobileMenu.classList.contains("open"), false);
    });
    mobileMenu.addEventListener("click", function (e) {
      // Fecha o menu ao escolher um link.
      if (e.target.closest("a")) setMobileMenu(false, false);
    });
    document.addEventListener("click", function (e) {
      if (mobileMenu.classList.contains("open") && !mobileMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
        setMobileMenu(false, false);
      }
    });
  }

  // ── Dropdown de notificações ─────────────────────────────────────────
  var notifBtn = document.getElementById("notif-btn");
  var notifDropdown = document.getElementById("notif-dropdown");
  var notifList = document.getElementById("notif-list");
  var notifBadge = document.getElementById("notif-badge");
  var notifMarkAll = document.getElementById("notif-mark-all");
  var notifWrap = notifBtn ? notifBtn.closest(".notif-wrap") : null;

  function postForm(url) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: "_csrf=" + encodeURIComponent(csrfToken),
    });
  }

  function setNotifOpen(open, returnFocus) {
    notifDropdown.classList.toggle("open", open);
    notifBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) loadNotifications();
    else if (returnFocus) notifBtn.focus();
  }

  function updateBadge(count) {
    if (!notifBadge) return;
    if (count > 0) {
      notifBadge.style.display = "flex";
      notifBadge.textContent = count > 9 ? "9+" : String(count);
    } else {
      notifBadge.style.display = "none";
    }
    notifBtn.setAttribute("aria-label", count > 0 ? "Notificações (" + count + " não lidas)" : "Notificações");
  }

  function timeAgo(dateStr) {
    var diffMin = Math.floor((new Date() - new Date(dateStr)) / 60000);
    if (diffMin < 1) return "Agora";
    if (diffMin < 60) return "Há " + diffMin + " min";
    var diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return "Há " + diffH + "h";
    var diffD = Math.floor(diffH / 24);
    if (diffD === 1) return "Ontem";
    return "Há " + diffD + " dias";
  }

  // Só aceita links internos do próprio site.
  function safeLink(link) {
    return typeof link === "string" && link.charAt(0) === "/" && link.charAt(1) !== "/" ? link : "/";
  }

  var unreadCount = 0;

  function renderNotifications(data) {
    if (!notifList) return;
    var notifications = data.notifications || [];
    unreadCount = data.unreadCount || 0;
    updateBadge(unreadCount);

    notifList.textContent = "";
    if (notifications.length === 0) {
      var empty = document.createElement("div");
      empty.className = "notif-empty";
      empty.textContent = "Nenhuma notificação";
      notifList.appendChild(empty);
      return;
    }

    notifications.forEach(function (n) {
      var a = document.createElement("a");
      a.href = safeLink(n.link);
      a.className = n.read ? "notif-item" : "notif-item notif-unread";
      a.setAttribute("data-notif-id", n._id);
      var msg = document.createElement("p");
      msg.textContent = n.message;
      var when = document.createElement("p");
      when.textContent = timeAgo(n.createdAt) + (n.read ? "" : " · não lida");
      a.appendChild(msg);
      a.appendChild(when);

      a.addEventListener("click", function (e) {
        if (!a.classList.contains("notif-unread")) return;
        e.preventDefault();
        var href = a.getAttribute("href");
        postForm("/api/notifications/" + encodeURIComponent(n._id) + "/read")
          .catch(function () { /* se falhar ao marcar como lida, segue para o link mesmo assim */ })
          .then(function () { window.location.href = href; });
      });
      notifList.appendChild(a);
    });
  }

  var notifLoading = false;
  var notifLoadedAt = 0;
  function loadNotifications() {
    if (notifLoading) return;
    // Reaberto logo em seguida: reaproveita a lista que já está na tela.
    if (notifLoadedAt && Date.now() - notifLoadedAt < 15000) return;
    notifLoading = true;
    if (!notifLoadedAt && notifList) {
      notifList.innerHTML = '<div class="notif-empty">Carregando...</div>';
    }
    fetch("/api/notifications", { headers: { "Accept": "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        notifLoadedAt = Date.now();
        renderNotifications(data);
      })
      .catch(function () {
        if (!notifLoadedAt && notifList) {
          notifList.innerHTML = '<div class="notif-empty">Não foi possível carregar as notificações.</div>';
        }
      })
      .then(function () { notifLoading = false; });
  }

  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      setNotifOpen(!notifDropdown.classList.contains("open"), false);
    });
    document.addEventListener("click", function (e) {
      if (notifDropdown.classList.contains("open") && !notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) {
        setNotifOpen(false, false);
      }
    });
    // Teclado: ao sair do bloco (Tab), a lista fecha para não cobrir a página.
    if (notifWrap) {
      notifWrap.addEventListener("focusout", function (e) {
        if (notifDropdown.classList.contains("open") && e.relatedTarget && !notifWrap.contains(e.relatedTarget)) {
          setNotifOpen(false, false);
        }
      });
    }
    var notifClose = document.getElementById("notif-close");
    if (notifClose) notifClose.addEventListener("click", function () { setNotifOpen(false, true); });

    if (notifMarkAll) {
      notifMarkAll.addEventListener("click", function () {
        postForm("/api/notifications/read-all").then(function () {
          if (notifList) {
            notifList.querySelectorAll(".notif-unread").forEach(function (el) { el.classList.remove("notif-unread"); });
          }
          unreadCount = 0;
          updateBadge(0);
        });
      });
    }
  }

  // Esc fecha o que estiver aberto e devolve o foco ao botão que abriu.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (notifDropdown && notifDropdown.classList.contains("open")) setNotifOpen(false, true);
    if (mobileMenu && mobileMenu.classList.contains("open")) setMobileMenu(false, true);
  });

  // ── Tema claro/escuro (botão da navbar) ──────────────────────────────
  var themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    var updateThemeIcon = function () {
      var isDark = document.documentElement.classList.contains("dark");
      themeBtn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
      themeBtn.setAttribute("title", isDark ? "Modo claro" : "Modo escuro");
      themeBtn.setAttribute("aria-label", isDark ? "Mudar para o modo claro" : "Mudar para o modo escuro");
    };
    themeBtn.addEventListener("click", function () {
      var isDark = document.documentElement.classList.toggle("dark");
      try { localStorage.setItem("theme", isDark ? "dark" : "light"); } catch (e) { /* preferência vale só nesta página */ }
      updateThemeIcon();
    });
    updateThemeIcon();
  }

  // ── Mostrar/ocultar senha ────────────────────────────────────────────
  document.querySelectorAll("[data-toggle-password]").forEach(function (btn) {
    btn.setAttribute("aria-label", "Mostrar senha");
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", function () {
      var input = document.getElementById(btn.getAttribute("data-toggle-password"));
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
      btn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
      btn.setAttribute("aria-pressed", show ? "true" : "false");
    });
  });

  // ── Acordeão do FAQ ──────────────────────────────────────────────────
  function setFaqOpen(item, open) {
    var btn = item.querySelector(".faq-q-btn");
    item.classList.toggle("open", open);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  document.querySelectorAll(".faq-item").forEach(function (item) {
    var btn = item.querySelector(".faq-q-btn");
    if (!btn) return;
    btn.setAttribute("aria-expanded", item.classList.contains("open") ? "true" : "false");
    btn.addEventListener("click", function () { setFaqOpen(item, !item.classList.contains("open")); });
  });

  // Link direto para uma pergunta (/faq#faq-<id>): abre e rola até ela.
  function openFaqFromHash() {
    if (!window.location.hash || window.location.hash.indexOf("#faq-") !== 0) return;
    var target = document.getElementById(window.location.hash.slice(1));
    if (target && target.classList.contains("faq-item")) {
      setFaqOpen(target, true);
      target.scrollIntoView({ block: "center" });
    }
  }
  openFaqFromHash();
  window.addEventListener("hashchange", openFaqFromHash);

  // ── Botões que mostram/escondem um bloco (ex.: formulário de denúncia) ─
  document.querySelectorAll("[data-toggle-target]").forEach(function (btn) {
    var target = document.getElementById(btn.getAttribute("data-toggle-target"));
    if (!target) return;
    btn.setAttribute("aria-expanded", target.hidden ? "false" : "true");
    btn.addEventListener("click", function () {
      target.hidden = !target.hidden;
      btn.setAttribute("aria-expanded", target.hidden ? "false" : "true");
      if (!target.hidden) {
        var first = target.querySelector("select, textarea, input:not([type=hidden]), button");
        if (first) first.focus();
      }
    });
  });

  // ── Confirmação antes de ações irreversíveis (data-confirm="mensagem") ─
  document.addEventListener("submit", function (e) {
    var message = e.target && e.target.getAttribute && e.target.getAttribute("data-confirm");
    if (message && !window.confirm(message)) e.preventDefault();
  });

  // ── Contador de caracteres (data-char-count="idDoContador" data-max="N") ─
  document.querySelectorAll("[data-char-count]").forEach(function (el) {
    var counter = document.getElementById(el.getAttribute("data-char-count"));
    if (!counter) return;
    var max = parseInt(el.getAttribute("data-max"), 10);
    var update = function () {
      var n = el.value.length;
      counter.textContent = max ? n + "/" + max + " caracteres" : n + " caracteres";
      counter.classList.toggle("over-limit", !!max && n > max);
    };
    el.addEventListener("input", update);
    update();
  });

  // ── Indicador de força de senha (cadastro) ───────────────────────────
  var pwField = document.getElementById("pwf");
  if (pwField) {
    var bars = document.querySelectorAll(".pw-strength-bar");
    var pwLabel = document.getElementById("pw-strength-label");
    pwField.addEventListener("input", function () {
      var v = pwField.value;
      var level = 0, text = "";
      if (v.length > 0 && v.length < 8) {
        level = 1; text = "Curta demais";
      } else if (v.length >= 8) {
        var extra = (v.length >= 12 ? 1 : 0)
          + (/[a-z]/.test(v) && /[A-Z]/.test(v) ? 1 : 0)
          + (/\d/.test(v) ? 1 : 0)
          + (/[^A-Za-z0-9]/.test(v) ? 1 : 0);
        if (extra <= 1) { level = 2; text = "Senha fraca"; }
        else if (extra === 2) { level = 3; text = "Senha média"; }
        else { level = 4; text = "Senha forte"; }
      }
      bars.forEach(function (bar, idx) { bar.classList.toggle("filled", idx < level); });
      if (pwLabel) pwLabel.textContent = text;
    });
  }

  // ── Apoiar sugestão sem recarregar a página ──────────────────────────
  // Sem JavaScript, o formulário continua funcionando (envio normal).
  document.querySelectorAll("form[data-support-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type=submit]");
      if (btn.disabled) return;
      btn.disabled = true;
      fetch(form.getAttribute("action"), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: "_csrf=" + encodeURIComponent(csrfToken),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          btn.classList.toggle("supported", !!data.supported);
          btn.setAttribute("aria-pressed", data.supported ? "true" : "false");
          btn.setAttribute("title", data.supported ? "Remover apoio" : "Apoiar sugestão");
          var label = btn.querySelector("[data-support-label]");
          if (label) label.textContent = data.supported ? "Apoiando" : "Apoiar";
          var card = form.closest(".suggestion-card");
          var total = card && card.querySelector("[data-support-total]");
          if (total) total.textContent = data.count + (data.count === 1 ? " apoio" : " apoios");
          var live = form.querySelector("[data-support-live]");
          if (live) live.textContent = data.supported ? "Apoio registrado." : "Apoio removido.";
        })
        .catch(function () {
          // Qualquer falha: cai no envio normal do formulário.
          form.removeAttribute("data-support-form");
          form.submit();
        })
        .then(function () { btn.disabled = false; });
    });
  });

  // ── Foco no resumo de erros (leitores de tela leem a mensagem) ───────
  var errorBox = document.querySelector("[data-autofocus-error]");
  if (errorBox) errorBox.focus();

  // ── Limpa da URL os avisos de uma única exibição ─────────────────────
  // Depois de salvar/publicar, o servidor redireciona com ?submitted=1 etc. Com
  // o aviso já exibido, esses parâmetros saem da barra de endereço; assim ele
  // não reaparece ao recarregar a página nem ao compartilhar o link.
  var TRANSIENT = ["submitted", "reported", "created", "removed", "removido", "enviada", "analise", "trocaEmail", "saved", "pwSaved", "ok", "erro"];
  if (window.history && window.history.replaceState && window.location.search) {
    var params = new URLSearchParams(window.location.search);
    var changed = false;
    TRANSIENT.forEach(function (key) {
      if (params.has(key)) { params.delete(key); changed = true; }
    });
    if (changed) {
      var qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
    }
  }
})();
