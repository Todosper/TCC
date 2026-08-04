const express = require("express");
const router = express.Router();
const User = require("../models/User");

// ─── LOGIN ──────────────────────────────────────────────────────────────────
router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { title: "Entrar", error: null });
});

router.post("/login", async (req, res) => {
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
      login: user.login,
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

router.post("/register", async (req, res) => {
  const { name, email, login, password, password2, role } = req.body;
  const errors = {};

  if (!name) errors.name = "Nome obrigatório.";
  if (!email) errors.email = "E-mail obrigatório.";
  else if (!email.includes("@")) errors.email = "E-mail inválido.";
  if (!login) errors.login = "Login obrigatório.";
  if (!password || password.length < 8) errors.password = "Senha deve ter ao menos 8 caracteres.";
  if (password !== password2) errors.password2 = "As senhas não coincidem.";
  if (!role) errors.role = "Selecione seu perfil.";

  if (Object.keys(errors).length === 0) {
    const existing = await User.findOne({ $or: [{ email }, { login }] });
    if (existing) {
      if (existing.email === email) errors.email = "Este e-mail já está cadastrado.";
      else errors.login = "Este login já está em uso.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.render("register", { title: "Criar Conta", errors, form: req.body, done: false });
  }

  try {
    await User.create({ name, email, login, password, role });
    res.render("register", { title: "Criar Conta", errors: {}, form: {}, done: true });
  } catch (err) {
    console.error(err);
    errors.general = "Erro ao criar conta. Tente novamente.";
    res.render("register", { title: "Criar Conta", errors, form: req.body, done: false });
  }
});

// ─── FORGOT PASSWORD ────────────────────────────────────────────────────────
router.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: false });
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.render("forgot-password", { title: "Recuperar Senha", error: "Informe um e-mail válido.", sent: false });
  }
  // Em um sistema real, aqui dispararia o envio de e-mail.
  res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: true });
});

// ─── LOGOUT ─────────────────────────────────────────────────────────────────
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

module.exports = router;
