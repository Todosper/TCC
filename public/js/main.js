// ============================================================
// Scripts gerais do site — sem dependências externas.
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
  // ── Menu mobile ──────────────────────────────────────────────────────
  var mobileToggle = document.getElementById("mobile-menu-toggle");
  var mobileMenu = document.getElementById("mobile-menu");
  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener("click", function () {
      mobileMenu.classList.toggle("open");
    });
  }

  // ── Dropdown de notificações ─────────────────────────────────────────
  var notifBtn = document.getElementById("notif-btn");
  var notifDropdown = document.getElementById("notif-dropdown");
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      notifDropdown.classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      if (!notifDropdown.contains(e.target) && e.target !== notifBtn) {
        notifDropdown.classList.remove("open");
      }
    });
    var notifClose = document.getElementById("notif-close");
    if (notifClose) {
      notifClose.addEventListener("click", function () {
        notifDropdown.classList.remove("open");
      });
    }
  }

  // ── Mostrar/ocultar senha ────────────────────────────────────────────
  document.querySelectorAll("[data-toggle-password]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var targetId = btn.getAttribute("data-toggle-password");
      var input = document.getElementById(targetId);
      if (!input) return;
      var isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      btn.innerHTML = isPassword ? EYE_OFF_SVG : EYE_SVG;
    });
  });

  // ── Accordion do FAQ ─────────────────────────────────────────────────
  document.querySelectorAll(".faq-q-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var item = btn.closest(".faq-item");
      if (item) item.classList.toggle("open");
    });
  });

  // ── Toggle de categoria (Fórum / FAQ) — navegação via querystring ────
  document.querySelectorAll("[data-filter-cat]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      // navegação normal via link <a href>, nada a fazer aqui
    });
  });

  // ── Contador de caracteres (textarea de resposta / título do tópico) ─
  document.querySelectorAll("[data-char-count]").forEach(function (el) {
    var targetId = el.getAttribute("data-char-count");
    var counter = document.getElementById(targetId);
    if (!counter) return;
    var update = function () {
      counter.textContent = el.value.length + " caracteres";
    };
    el.addEventListener("input", update);
    update();
  });

  // ── Indicador de força de senha (registro) ───────────────────────────
  var pwField = document.getElementById("pwf");
  if (pwField) {
    var bars = document.querySelectorAll(".pw-strength-bar");
    pwField.addEventListener("input", function () {
      var len = pwField.value.length;
      bars.forEach(function (bar, idx) {
        var threshold = (idx + 1) * 2;
        if (len >= threshold) bar.classList.add("filled");
        else bar.classList.remove("filled");
      });
    });
  }

  // ── Tabs genéricas (perfil, admin, criar-tópico) via querystring ────
  // (Implementadas via links <a> simples — não requer JS adicional)
});

var EYE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
var EYE_OFF_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

// ── Dark mode ─────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  var toggleBtn = document.getElementById("theme-toggle");
  if (!toggleBtn) return;

  function updateIcon() {
    var isDark = document.documentElement.classList.contains("dark");
    toggleBtn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
    toggleBtn.setAttribute("title", isDark ? "Modo claro" : "Modo escuro");
  }

  toggleBtn.addEventListener("click", function () {
    var isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    updateIcon();
  });

  updateIcon();
});

var MOON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
var SUN_SVG  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
