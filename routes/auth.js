const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const firebase = require("../helpers/firebase");
const { loginLimiter, forgotLimiter, registerLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");
const { asString } = require("../helpers/query");
const { safeNext } = require("../helpers/redirect");
const {
  normalizeEmail,
  isValidEmailFormat,
  isAllowedEmailDomain,
  EMAIL_DOMAIN_MESSAGE,
} = require("../helpers/email");

// Intervalo mínimo entre dois reenvios automáticos do e-mail de verificação
// (evita encher a caixa de entrada de quem tenta entrar várias vezes).
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

const PASSWORD_MIN = 8;
// O bcrypt só considera os primeiros 72 bytes da senha; acima disso, senhas
// diferentes seriam tratadas como iguais.
const PASSWORD_MAX_BYTES = 72;
const NAME_MIN = 2;
const NAME_MAX = 100;

// Mostra a tela de login com uma mensagem. O status HTTP importa para o limite
// de tentativas: respostas com status de erro (>= 400) contam como tentativa
// falha; respostas 200 não contam (ex.: senha correta, mas e-mail não confirmado).
function renderLogin(res, error, { email = "", next = "", status = 200 } = {}) {
  return res.status(status).render("login", { title: "Entrar", error, form: { email, next } });
}

function startSession(req, user) {
  // Gera um novo id de sessão no login, para que um id anterior ao login nunca
  // passe a valer como sessão autenticada.
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin,
      };
      // Marca o início desta sessão. Se a senha for trocada depois, a sessão
      // deixa de valer (ver middleware/auth.js).
      req.session.authAt = Date.now();
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

// ─── LOGIN ──────────────────────────────────────────────────────────────────
router.get("/login", (req, res) => {
  const next = safeNext(asString(req.query.next));
  if (req.session.user) return res.redirect(next);
  res.render("login", { title: "Entrar", error: null, form: { email: "", next: next === "/" ? "" : next } });
});

router.post("/login", loginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.loginOrEmail);
  const password = asString(req.body.password);
  const rawNext = asString(req.body.next);
  const next = safeNext(rawNext);
  const formNext = next === "/" ? "" : next;
  const fail = (error, status = 401) => renderLogin(res, error, { email, next: formNext, status });

  try {
    if (!email || !password) return fail("Preencha o e-mail e a senha.", 400);

    const user = await User.findOne({ email });
    if (!user) return fail("E-mail ou senha inválidos.");

    // O bloqueio só é informado depois de confirmar a senha, para não revelar
    // a quem não a conhece que a conta existe e está bloqueada.
    const blocked = () => fail("Sua conta está bloqueada. Contate a administração.", 403);

    if (user.firebaseUid) {
      // Conta vinculada ao Firebase: é o Firebase que confere a senha. Assim,
      // uma senha redefinida pelo e-mail passa a valer na hora e a antiga deixa
      // de valer.
      if (!firebase.isConfigured()) {
        return fail("Serviço de autenticação indisponível no momento. Tente mais tarde.", 503);
      }

      let fbSession;
      try {
        fbSession = await firebase.signIn(user.email, password);
      } catch (err) {
        if (firebase.isInvalidCredentials(err)) return fail("E-mail ou senha inválidos.");
        if (err.code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
          return fail("Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429);
        }
        throw err;
      }

      if (user.status === "bloqueado") return blocked();

      const verified = await firebase.isEmailVerified(fbSession.idToken);
      if (!verified) {
        let resent = false;
        const last = user.verificationEmailSentAt ? user.verificationEmailSentAt.getTime() : 0;
        const elapsed = Date.now() - last;
        if (elapsed > RESEND_COOLDOWN_MS) {
          try {
            await firebase.sendVerificationEmail(fbSession.idToken);
            user.verificationEmailSentAt = new Date();
            await user.save();
            resent = true;
          } catch (err) {
            console.error("Falha ao reenviar e-mail de verificação:", err.message);
          }
        }
        const waitMinutes = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 60000));
        const message = resent
          ? `Seu e-mail ainda não foi confirmado. Enviamos um novo link para ${user.email} — confira também o spam.`
          : `Seu e-mail ainda não foi confirmado. Já enviamos um link para ${user.email} — confira a caixa de entrada e o spam. Se não encontrar, tente entrar de novo em cerca de ${waitMinutes} min para receber outro.`;
        // Status 200: a senha estava correta, então não conta como tentativa falha.
        return renderLogin(res, message, { email, next: formNext });
      }

      // Mantém o MongoDB em sincronia com o Firebase: e-mail verificado e hash
      // da senha, que muda quando ela é redefinida pelo link do e-mail. Uma
      // senha nova encerra as outras sessões abertas dessa conta.
      if (user.emailVerified !== true) user.emailVerified = true;
      if (!(await user.comparePassword(password))) {
        user.password = password;
        user.passwordChangedAt = new Date();
      }
      if (user.isModified()) await user.save();
    } else {
      // Conta antiga, sem Firebase: a senha é conferida com bcrypt.
      const match = await user.comparePassword(password);
      if (!match) return fail("E-mail ou senha inválidos.");
      if (user.status === "bloqueado") return blocked();
    }

    await startSession(req, user);
    res.redirect(next);
  } catch (err) {
    console.error(err);
    fail("Erro ao entrar. Tente novamente.", 500);
  }
});

// ─── REGISTER ───────────────────────────────────────────────────────────────
router.get("/register", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("register", { title: "Criar Conta", errors: {}, form: {}, done: false });
});

router.post("/register", registerLimiter, asyncHandler(async (req, res) => {
  const name = asString(req.body.name).trim();
  const email = normalizeEmail(req.body.email);
  const password = asString(req.body.password);
  const password2 = asString(req.body.password2);
  const form = { name, email };
  const errors = {};

  if (name.length < NAME_MIN) errors.name = "Informe seu nome completo.";
  else if (name.length > NAME_MAX) errors.name = `O nome deve ter no máximo ${NAME_MAX} caracteres.`;

  if (!email) errors.email = "E-mail obrigatório.";
  else if (!isValidEmailFormat(email)) errors.email = "E-mail inválido.";
  else if (!isAllowedEmailDomain(email)) errors.email = EMAIL_DOMAIN_MESSAGE;

  if (password.length < PASSWORD_MIN) errors.password = `A senha deve ter ao menos ${PASSWORD_MIN} caracteres.`;
  else if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) errors.password = "A senha é longa demais (máximo de 72 caracteres).";
  if (password !== password2) errors.password2 = "As senhas não coincidem.";

  if (Object.keys(errors).length === 0) {
    const existing = await User.findOne({ email });
    if (existing) errors.email = "Este e-mail já está cadastrado.";
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).render("register", { title: "Criar Conta", errors, form, done: false });
  }

  // 1) Cria a conta no Firebase (se estiver configurado). Se falhar, nada é
  //    gravado no MongoDB.
  let fbSession = null;
  if (firebase.isConfigured()) {
    try {
      fbSession = await firebase.signUp(email, password);
    } catch (err) {
      if (err.code === "EMAIL_EXISTS") {
        // Sobra de um cadastro anterior (ex.: usuário apagado do MongoDB, mas
        // não do Firebase). Se a senha informada for a mesma, reaproveita.
        try {
          fbSession = await firebase.signIn(email, password);
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
      return res.status(400).render("register", { title: "Criar Conta", errors, form, done: false });
    }
  }

  // 2) Cria o usuário no MongoDB.
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
        // Não derruba o cadastro: ao entrar, o link é reenviado automaticamente.
        console.error("Falha ao enviar e-mail de verificação:", err.message);
      }
      verifyEmail = user.email;
    }

    res.render("register", { title: "Criar Conta", errors: {}, form: {}, done: true, verifyEmail });
  } catch (err) {
    console.error(err);
    errors.general = "Erro ao criar conta. Tente novamente.";
    res.status(500).render("register", { title: "Criar Conta", errors, form, done: false });
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

router.post("/forgot-password", forgotLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidEmailFormat(email)) {
    return res.status(400).render("forgot-password", { title: "Recuperar Senha", error: "Informe um e-mail válido.", sent: false });
  }

  if (firebase.isConfigured()) {
    try {
      const user = await User.findOne({ email });

      if (user && user.status !== "bloqueado") {
        // Conta antiga, ainda sem Firebase: cria a conta lá com uma senha
        // aleatória (que ninguém conhece) e vincula. A pessoa define a senha
        // real pelo link do e-mail.
        if (!user.firebaseUid) {
          try {
            const fb = await firebase.signUp(email, crypto.randomBytes(24).toString("base64url"));
            user.firebaseUid = fb.localId;
            await user.save();
          } catch (err) {
            if (err.code !== "EMAIL_EXISTS") throw err;
          }
        }
        await firebase.sendPasswordReset(email);
      }
    } catch (err) {
      console.error("Falha ao enviar e-mail de recuperação de senha:", err.message);
    }
  }

  res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: true });
});

// ─── LOGOUT ─────────────────────────────────────────────────────────────────
// É POST (e não GET) para que outro site não consiga encerrar a sessão do
// usuário sem interação real dele.
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

module.exports = router;
