const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const firebase = require("../helpers/firebase");
const { loginLimiter, registerLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

// Intervalo mínimo entre dois reenvios automáticos do e-mail de verificação
// (evita encher a caixa de entrada de quem tenta logar várias vezes).
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

const INVALID_CREDENTIALS = ["INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND"];

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

    if (user.firebaseUid) {
      // ── Conta vinculada ao Firebase: o Firebase é quem confere a senha ──
      // (assim, uma senha redefinida pelo e-mail passa a valer na hora e a
      // senha antiga deixa de valer).
      if (!firebase.isConfigured()) {
        return res.render("login", { title: "Entrar", error: "Serviço de autenticação indisponível no momento. Tente mais tarde." });
      }

      let fbSession;
      try {
        fbSession = await firebase.signIn(user.email, password);
      } catch (err) {
        if (INVALID_CREDENTIALS.includes(err.code)) {
          return res.render("login", { title: "Entrar", error: "E-mail ou senha inválidos." });
        }
        if (err.code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
          return res.render("login", { title: "Entrar", error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
        }
        throw err;
      }

      const verified = await firebase.isEmailVerified(fbSession.idToken);
      if (!verified) {
        let resent = false;
        const last = user.verificationEmailSentAt ? user.verificationEmailSentAt.getTime() : 0;
        if (Date.now() - last > RESEND_COOLDOWN_MS) {
          try {
            await firebase.sendVerificationEmail(fbSession.idToken);
            user.verificationEmailSentAt = new Date();
            await user.save();
            resent = true;
          } catch (err) {
            console.error("Falha ao reenviar e-mail de verificação:", err.message);
          }
        }
        return res.render("login", {
          title: "Entrar",
          error: resent
            ? `Seu e-mail ainda não foi confirmado. Enviamos um novo link para ${user.email} — confira também o spam.`
            : "Seu e-mail ainda não foi confirmado. Clique no link que enviamos para a sua caixa de entrada (confira também o spam).",
        });
      }

      // Mantém o MongoDB em sincronia com o Firebase (e-mail verificado e
      // hash da senha — que muda quando a senha é redefinida pelo e-mail).
      if (user.emailVerified !== true) user.emailVerified = true;
      if (!(await user.comparePassword(password))) user.password = password;
      if (user.isModified()) await user.save();
    } else {
      // ── Conta antiga (sem Firebase): fluxo original com bcrypt ──
      const match = await user.comparePassword(password);
      if (!match) {
        return res.render("login", { title: "Entrar", error: "E-mail ou senha inválidos." });
      }
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

// asyncHandler: a checagem de e-mail duplicado (User.findOne) roda fora de um
// try/catch; se o banco falhar ali, a Promise rejeitada derrubava o processo.
router.post("/register", registerLimiter, asyncHandler(async (req, res) => {
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

  // 1) Cria a conta no Firebase (se estiver configurado). Se falhar, nada é
  //    gravado no MongoDB.
  const normalizedEmail = email.toLowerCase().trim();
  let fbSession = null;
  if (firebase.isConfigured()) {
    try {
      fbSession = await firebase.signUp(normalizedEmail, password);
    } catch (err) {
      if (err.code === "EMAIL_EXISTS") {
        // Sobra de um cadastro anterior (ex.: usuário apagado do MongoDB, mas
        // não do Firebase). Se a senha informada for a mesma, reaproveita.
        try {
          fbSession = await firebase.signIn(normalizedEmail, password);
        } catch (e) {
          errors.email = "Este e-mail já está cadastrado.";
        }
      } else if (err.code === "INVALID_EMAIL") {
        errors.email = "E-mail inválido.";
      } else if (err.code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
        errors.general = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
      } else {
        console.error("Erro ao criar conta no Firebase:", err.message);
        errors.general = "Erro ao criar conta. Tente novamente.";
      }
    }
    if (Object.keys(errors).length > 0) {
      return res.render("register", { title: "Criar Conta", errors, form: req.body, done: false });
    }
  }

  // 2) Cria o usuário no MongoDB, como sempre foi feito.
  try {
    const data = { name, email, password };
    if (fbSession) {
      data.firebaseUid = fbSession.localId;
      data.emailVerified = false;
    }
    const user = await User.create(data);

    // 3) Pede ao Firebase para enviar o e-mail de verificação.
    let verifyEmail = null;
    if (fbSession) {
      try {
        await firebase.sendVerificationEmail(fbSession.idToken);
        user.verificationEmailSentAt = new Date();
        await user.save();
      } catch (err) {
        // Não derruba o cadastro: no login, o link é reenviado automaticamente.
        console.error("Falha ao enviar e-mail de verificação:", err.message);
      }
      verifyEmail = user.email;
    }

    res.render("register", { title: "Criar Conta", errors: {}, form: {}, done: true, verifyEmail });
  } catch (err) {
    console.error(err);
    errors.general = "Erro ao criar conta. Tente novamente.";
    res.render("register", { title: "Criar Conta", errors, form: req.body, done: false });
  }
}));

// ─── FORGOT PASSWORD ────────────────────────────────────────────────────────
// Quem envia o e-mail é o Firebase; o link abre a página de redefinição do
// próprio Firebase. A nova senha passa a valer no próximo login, e o hash do
// MongoDB é atualizado nesse momento (ver POST /login).
//
// A resposta é sempre a mesma ("e-mail enviado"), exista a conta ou não, para
// não revelar quais e-mails estão cadastrados.
router.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: false });
});

router.post("/forgot-password", loginLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.render("forgot-password", { title: "Recuperar Senha", error: "Informe um e-mail válido.", sent: false });
  }

  if (firebase.isConfigured()) {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const user = await User.findOne({ email: normalizedEmail });

      if (user && user.status !== "bloqueado") {
        // Conta antiga, ainda sem Firebase: cria a conta lá com uma senha
        // aleatória (que ninguém conhece) e vincula. A pessoa define a senha
        // real pelo link do e-mail.
        if (!user.firebaseUid) {
          try {
            const fb = await firebase.signUp(normalizedEmail, crypto.randomBytes(24).toString("base64url"));
            user.firebaseUid = fb.localId;
            await user.save();
          } catch (err) {
            if (err.code !== "EMAIL_EXISTS") throw err;
          }
        }
        await firebase.sendPasswordReset(normalizedEmail);
      }
    } catch (err) {
      console.error("Falha ao enviar e-mail de recuperação de senha:", err.message);
    }
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
