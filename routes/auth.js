const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { loginLimiter, registerLimiter, passwordResetLimiter, resendVerificationLimiter } = require("../middleware/rateLimit");
const { generateToken, hashToken } = require("../helpers/tokens");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../helpers/email");

const EMAIL_VERIFY_EXPIRY_MS = 1000 * 60 * 60 * 24; // 24 horas
const PASSWORD_RESET_EXPIRY_MS = 1000 * 60 * 60; // 1 hora

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
    // Corrigido: antes a checagem de duplicidade não normalizava
    // maiúsculas/minúsculas, enquanto o schema salva o e-mail sempre em
    // minúsculas — podia deixar passar um e-mail "duplicado" até bater no
    // índice único do banco e mostrar um erro genérico e confuso.
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) errors.email = "Este e-mail já está cadastrado.";
  }

  if (Object.keys(errors).length > 0) {
    return res.render("register", { title: "Criar Conta", errors, form: req.body, done: false });
  }

  try {
    const user = await User.create({ name, email, password });

    // Gera o token de verificação de e-mail e dispara o envio. Se o envio
    // falhar (ex.: RESEND_API_KEY ainda não configurada), a conta já foi
    // criada normalmente — a pessoa só continua sem o e-mail verificado até
    // pedir um novo link em /reenviar-verificacao.
    const { raw, hash } = generateToken();
    user.emailVerifyTokenHash = hash;
    user.emailVerifyTokenExpires = new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MS);
    await user.save();
    await sendVerificationEmail(user, raw);

    res.render("register", { title: "Criar Conta", errors: {}, form: {}, done: true });
  } catch (err) {
    console.error(err);
    errors.general = "Erro ao criar conta. Tente novamente.";
    res.render("register", { title: "Criar Conta", errors, form: req.body, done: false });
  }
});

// ─── VERIFICAÇÃO DE E-MAIL ──────────────────────────────────────────────────
router.get("/verificar-email", async (req, res) => {
  try {
    const { token, id } = req.query;
    if (!token || !id) {
      return res.render("verify-email", { title: "Verificar e-mail", status: "invalid" });
    }

    const user = await User.findOne({
      _id: id,
      emailVerifyTokenHash: hashToken(token),
      emailVerifyTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.render("verify-email", { title: "Verificar e-mail", status: "invalid" });
    }

    user.emailVerified = true;
    user.emailVerifyTokenHash = null;
    user.emailVerifyTokenExpires = null;
    await user.save();

    res.render("verify-email", { title: "Verificar e-mail", status: "success" });
  } catch (err) {
    console.error(err);
    res.render("verify-email", { title: "Verificar e-mail", status: "invalid" });
  }
});

router.get("/reenviar-verificacao", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.render("resend-verification", { title: "Reenviar verificação", sent: false, alreadyVerified: false });
});

router.post("/reenviar-verificacao", resendVerificationLimiter, async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  try {
    const user = await User.findById(req.session.user.id);
    if (!user || user.emailVerified) {
      return res.render("resend-verification", { title: "Reenviar verificação", sent: false, alreadyVerified: true });
    }

    const { raw, hash } = generateToken();
    user.emailVerifyTokenHash = hash;
    user.emailVerifyTokenExpires = new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MS);
    await user.save();
    await sendVerificationEmail(user, raw);

    res.render("resend-verification", { title: "Reenviar verificação", sent: true, alreadyVerified: false });
  } catch (err) {
    console.error(err);
    res.render("resend-verification", { title: "Reenviar verificação", sent: false, alreadyVerified: false });
  }
});

// ─── FORGOT PASSWORD ────────────────────────────────────────────────────────
router.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: false });
});

router.post("/forgot-password", passwordResetLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.render("forgot-password", { title: "Recuperar Senha", error: "Informe um e-mail válido.", sent: false });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    // Sempre mostra a mesma tela de sucesso, exista ou não o e-mail — isso
    // evita que alguém use este formulário para descobrir quais e-mails
    // estão cadastrados no sistema (enumeração de usuários). O e-mail de
    // verdade só é enviado se a conta existir.
    if (user) {
      const { raw, hash } = generateToken();
      user.passwordResetTokenHash = hash;
      user.passwordResetTokenExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
      await user.save();
      await sendPasswordResetEmail(user, raw);
    }
    res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: true });
  } catch (err) {
    console.error(err);
    res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: true });
  }
});

router.get("/redefinir-senha", async (req, res) => {
  const { token, id } = req.query;
  if (!token || !id) {
    return res.render("reset-password", { title: "Redefinir Senha", valid: false, error: null, token: null, id: null });
  }
  const user = await User.findOne({
    _id: id,
    passwordResetTokenHash: hashToken(token),
    passwordResetTokenExpires: { $gt: new Date() },
  });
  res.render("reset-password", {
    title: "Redefinir Senha",
    valid: !!user,
    error: null,
    token: user ? token : null,
    id: user ? id : null,
  });
});

router.post("/redefinir-senha", passwordResetLimiter, async (req, res) => {
  const { token, id, password, password2 } = req.body;

  const renderInvalid = () =>
    res.render("reset-password", { title: "Redefinir Senha", valid: false, error: null, token: null, id: null });

  if (!token || !id) return renderInvalid();

  try {
    const user = await User.findOne({
      _id: id,
      passwordResetTokenHash: hashToken(token),
      passwordResetTokenExpires: { $gt: new Date() },
    });
    if (!user) return renderInvalid();

    if (!password || password.length < 8) {
      return res.render("reset-password", {
        title: "Redefinir Senha", valid: true, error: "A senha deve ter ao menos 8 caracteres.", token, id,
      });
    }
    if (password !== password2) {
      return res.render("reset-password", {
        title: "Redefinir Senha", valid: true, error: "As senhas não coincidem.", token, id,
      });
    }

    user.password = password; // o hook pre("save") do model já faz o hash
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpires = null;
    await user.save();

    res.render("reset-password-success", { title: "Senha redefinida" });
  } catch (err) {
    console.error(err);
    renderInvalid();
  }
});

// ─── LOGOUT ─────────────────────────────────────────────────────────────────
// Corrigido: era uma rota GET, o que é má prática para uma ação que altera
// estado (uma tag <img src="/logout"> em qualquer outro site conseguiria
// deslogar alguém sem interação real). Agora exige POST.
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

module.exports = router;
