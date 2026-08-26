const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { loginLimiter, registerLimiter } = require("../middleware/rateLimit");

// ─── LOGIN ──────────────────────────────────────────────────────────────────
router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { title: "Entrar", error: null });
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { loginOrEmail, password } = req.body;

    if (!loginOrEmail || !password) {
      return res.render("login", { title: "Entrar", error: "Preencha o e-mail e a senha." });
    }

    const user = await User.findOne({ email: loginOrEmail.toLowerCase() });

    if (!user) {
      return res.render("login", { title: "Entrar", error: "E-mail ou senha inválidos." });
    }

    if (user.status === "bloqueado") {
      return res.render("login", { title: "Entrar", error: "Sua conta está bloqueada. Contate a administração." });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      return res.render("login", { title: "Entrar", error: "E-mail ou senha inválidos." });
    }

    req.session.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      isAdmin: user.isAdmin,
    };

    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.render("login", { title: "Entrar", error: "Erro ao entrar. Tente novamente." });
  }
});

// ─── REGISTER ───────────────────────────────────────────────────────────────
router.get("/register", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("register", { title: "Criar Conta", errors: {}, form: {}, done: false });
});

router.post("/register", registerLimiter, async (req, res) => {
  const { name, email, password, password2 } = req.body;
  const errors = {};

  if (!name) errors.name = "Nome obrigatório.";
  if (!email) errors.email = "E-mail obrigatório.";
  else if (!email.includes("@")) errors.email = "E-mail inválido.";
  if (!password || password.length < 8) errors.password = "Senha deve ter ao menos 8 caracteres.";
  if (password !== password2) errors.password2 = "As senhas não coincidem.";

  if (Object.keys(errors).length === 0) {
    // A checagem de duplicidade normaliza para minúsculas, igual ao schema
    // (que já salva o e-mail sempre em minúsculas) — evita deixar passar um
    // e-mail "duplicado" só por diferença de maiúsculas/minúsculas até bater
    // no índice único do banco e mostrar um erro genérico e confuso.
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) errors.email = "Este e-mail já está cadastrado.";
  }

  if (Object.keys(errors).length > 0) {
    return res.render("register", { title: "Criar Conta", errors, form: req.body, done: false });
  }

  try {
    await User.create({ name, email, password });
    res.render("register", { title: "Criar Conta", errors: {}, form: {}, done: true });
  } catch (err) {
    console.error(err);
    errors.general = "Erro ao criar conta. Tente novamente.";
    res.render("register", { title: "Criar Conta", errors, form: req.body, done: false });
  }
});

// ─── FORGOT PASSWORD ────────────────────────────────────────────────────────
// Nota: este fluxo ainda não envia e-mail de verdade (funcionalidade de
// e-mail foi removida do projeto por decisão consciente, por enquanto).
// A tela mostra uma mensagem de sucesso, mas nenhuma redefinição real
// acontece — quem esquecer a senha precisa ser ajudado manualmente por um
// admin até esse fluxo ser reintroduzido.
router.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: false });
});

router.post("/forgot-password", loginLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.render("forgot-password", { title: "Recuperar Senha", error: "Informe um e-mail válido.", sent: false });
  }
  res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: true });
});

// ─── LOGOUT ─────────────────────────────────────────────────────────────────
// Ação que altera estado (encerra a sessão) — por isso é POST, não GET, para
// não ser disparável a partir de outro site sem interação real do usuário.
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

module.exports = router;
