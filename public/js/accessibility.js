// ============================================================
// Painel de acessibilidade — sem dependências externas.
// Depende de main.js apenas para os ícones globais MOON_SVG / SUN_SVG.
// As preferências ficam no localStorage e são aplicadas antes da primeira
// renderização por um script no <head> do layout.
// ============================================================

(function () {
  var KEY_SIZE = "a11y-font-size";
  var KEY_CONTRAST = "a11y-contrast";
  var KEY_LINKS = "a11y-links";
  // Botão do VLibras: escondido por padrão. Só é gravado quando a pessoa o ativa ("1").
  var KEY_LIBRAS = "a11y-libras-visible";
  var SIZE_MIN = 80, SIZE_MAX = 150, SIZE_STEP = 10, SIZE_DEFAULT = 100;

  var root = document.documentElement;

  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* armazenamento indisponível: a preferência vale só nesta página */ }
  }

  function systemPrefersDark() {
    return !window.matchMedia || window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var panel = document.getElementById("a11y-panel");
    if (!panel) return;

    var triggers = document.querySelectorAll("[data-a11y-toggle]");
    var closeBtn = document.getElementById("a11y-close");
    var themeBtns = panel.querySelectorAll("[data-a11y-theme]");
    var sizeDec = document.getElementById("a11y-size-dec");
    var sizeInc = document.getElementById("a11y-size-inc");
    var sizeValue = document.getElementById("a11y-size-value");
    var contrastSwitch = document.getElementById("a11y-contrast");
    var linksSwitch = document.getElementById("a11y-links");
    var librasSwitch = document.getElementById("a11y-libras");
    var librasMsg = document.getElementById("a11y-libras-msg");
    var resetBtn = document.getElementById("a11y-reset");
    var mobileMenu = document.getElementById("mobile-menu");

    // ── Abrir / fechar ─────────────────────────────────────────────────
    function isOpen() { return !panel.hasAttribute("hidden"); }

    function setTriggersExpanded(expanded) {
      triggers.forEach(function (t) { t.setAttribute("aria-expanded", expanded ? "true" : "false"); });
    }

    function openPanel(fromMobile) {
      panel.removeAttribute("hidden");
      setTriggersExpanded(true);
      if (fromMobile && mobileMenu) mobileMenu.classList.remove("open");
      panel.focus();
    }

    function closePanel(returnFocus) {
      panel.setAttribute("hidden", "");
      setTriggersExpanded(false);
      if (returnFocus) {
        var visible = Array.prototype.filter.call(triggers, function (t) { return t.offsetParent !== null; })[0];
        // No celular o botão do painel fica dentro do menu fechado; o foco volta ao botão do menu.
        var fallback = document.getElementById("mobile-menu-toggle");
        if (visible) visible.focus();
        else if (fallback) fallback.focus();
      }
    }

    triggers.forEach(function (t) {
      t.addEventListener("click", function () {
        if (isOpen()) closePanel(false);
        else openPanel(t.hasAttribute("data-a11y-from-mobile"));
      });
    });
    if (closeBtn) closeBtn.addEventListener("click", function () { closePanel(true); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) closePanel(true);
    });

    // ── Aparência (claro / escuro), em sincronia com o botão da navbar ──
    function syncTheme() {
      var isDark = root.classList.contains("dark");
      themeBtns.forEach(function (b) {
        var active = b.getAttribute("data-a11y-theme") === (isDark ? "dark" : "light");
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
      // Mantém o ícone do botão de tema da navbar em sincronia.
      var navToggle = document.getElementById("theme-toggle");
      if (navToggle && typeof SUN_SVG !== "undefined" && typeof MOON_SVG !== "undefined") {
        navToggle.innerHTML = isDark ? SUN_SVG : MOON_SVG;
        navToggle.setAttribute("title", isDark ? "Modo claro" : "Modo escuro");
        navToggle.setAttribute("aria-label", isDark ? "Mudar para o modo claro" : "Mudar para o modo escuro");
      }
    }

    themeBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        var dark = b.getAttribute("data-a11y-theme") === "dark";
        root.classList.toggle("dark", dark);
        try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) { /* preferência vale só nesta página */ }
        syncTheme();
      });
    });

    // Se o tema mudar pelo botão da navbar, o painel acompanha.
    new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ["class"] });
    syncTheme();

    // ── Tamanho do texto ───────────────────────────────────────────────
    var currentSize = parseInt(read(KEY_SIZE), 10);
    if (!(currentSize >= SIZE_MIN && currentSize <= SIZE_MAX)) currentSize = SIZE_DEFAULT;

    function applySize(size) {
      currentSize = Math.max(SIZE_MIN, Math.min(SIZE_MAX, size));
      root.style.fontSize = currentSize === SIZE_DEFAULT ? "" : currentSize + "%";
      write(KEY_SIZE, currentSize === SIZE_DEFAULT ? null : String(currentSize));
      sizeValue.textContent = currentSize + "%";
      sizeDec.disabled = currentSize <= SIZE_MIN;
      sizeInc.disabled = currentSize >= SIZE_MAX;
    }
    sizeDec.addEventListener("click", function () { applySize(currentSize - SIZE_STEP); });
    sizeInc.addEventListener("click", function () { applySize(currentSize + SIZE_STEP); });
    applySize(currentSize);

    // ── Alto contraste e Destacar links ────────────────────────────────
    function bindClassSwitch(sw, className, key) {
      function render() { sw.setAttribute("aria-checked", root.classList.contains(className) ? "true" : "false"); }
      sw.addEventListener("click", function () {
        var on = root.classList.toggle(className);
        write(key, on ? "1" : null);
        render();
      });
      render();
      return function set(on) {
        root.classList.toggle(className, on);
        write(key, on ? "1" : null);
        render();
      };
    }
    var setContrast = bindClassSwitch(contrastSwitch, "a11y-contrast", KEY_CONTRAST);
    var setLinks = bindClassSwitch(linksSwitch, "a11y-links", KEY_LINKS);

    // ── Botão de Libras (VLibras) ──────────────────────────────────────
    // O interruptor mostra ou esconde o botão flutuante do VLibras; ele não
    // abre nem fecha a tradução. O widget em si é carregado por layout.ejs
    // (window.loadVLibras) e só é baixado depois que a pessoa ativa o botão.
    function librasVisible() { return !root.classList.contains("a11y-libras-hidden"); }
    function showLibrasMsg(show) { if (librasMsg) librasMsg.hidden = !show; }
    function renderLibras() {
      librasSwitch.setAttribute("aria-checked", librasVisible() ? "true" : "false");
    }
    function setLibras(visible) {
      root.classList.toggle("a11y-libras-hidden", !visible);
      write(KEY_LIBRAS, visible ? "1" : null);
      showLibrasMsg(false);
      if (visible && typeof window.loadVLibras === "function") window.loadVLibras();
      renderLibras();
    }
    librasSwitch.addEventListener("click", function () { setLibras(!librasVisible()); });
    // layout.ejs avisa quando o script do VLibras não pôde ser carregado.
    document.addEventListener("vlibras:error", function () { if (librasVisible()) showLibrasMsg(true); });
    renderLibras();

    // ── Restaurar configurações ────────────────────────────────────────
    resetBtn.addEventListener("click", function () {
      applySize(SIZE_DEFAULT);
      setContrast(false);
      setLinks(false);
      // Tema padrão: o do sistema (mesma regra do script no <head> do layout).
      root.classList.toggle("dark", systemPrefersDark());
      try { localStorage.removeItem("theme"); } catch (e) { /* sem armazenamento: nada a limpar */ }
      syncTheme();
      setLibras(false);
    });
  });
})();
