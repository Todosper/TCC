const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const firebase = require("../helpers/firebase");
const google = require("../helpers/google");
const accounts = require("../helpers/accounts");
const { requireAuth } = require("../middleware/auth");
const { loginLimiter, forgotLimiter, resendLimiter, registerLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");
const { asString } = require("../helpers/query");
const { safeNext } = require("../helpers/redirect");
const {
  normalizeEmail,
  isValidEmailFormat,
  isAllowedEmailDomain,
  EMAIL_DOMAIN_MESSAGE,
  ALLOWED_EMAIL_DOMAINS,
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
// `unverified` mostra, abaixo do botão Entrar, o botão "Reenviar e-mail de confirmação".
function renderLogin(res, error, { email = "", next = "", status = 200, unverified = false } = {}) {
  return res.status(status).render("login", { title: "Entrar", error, form: { email, next }, unverified });
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
        fbSession = await firebase.signIn(user.firebaseEmail || user.email, password);
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
        return renderLogin(res, message, { email, next: formNext, unverified: true });
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
// Botão "Reenviar e-mail de confirmação" da tela de login. O Firebase só aceita o
// pedido de quem acabou de entrar com a senha, então o formulário de login
// (e-mail + senha) é reaproveitado: aqui a senha é conferida, mas nenhuma sessão
// é aberta. Respeita o mesmo intervalo mínimo do reenvio automático do login.
router.post("/login/reenviar-confirmacao", resendLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.loginOrEmail);
  const password = asString(req.body.password);
  const next = safeNext(asString(req.body.next));
  const formNext = next === "/" ? "" : next;
  const fail = (error, status = 401) => renderLogin(res, error, { email, next: formNext, status });
  const info = (message) => renderLogin(res, message, { email, next: formNext, unverified: true });

  try {
    if (!email || !password) return fail("Preencha o e-mail e a senha para receber outro e-mail de confirmação.", 400);

    const user = await User.findOne({ email });
    // Só contas ligadas ao Firebase têm e-mail para confirmar. A mensagem é a
    // mesma de senha errada, para não revelar quais e-mails existem.
    if (!user || !user.firebaseUid) return fail("E-mail ou senha inválidos.");
    if (!firebase.isConfigured()) return fail("Serviço de autenticação indisponível no momento. Tente mais tarde.", 503);

    let fbSession;
    try {
      fbSession = await firebase.signIn(user.firebaseEmail || user.email, password);
    } catch (err) {
      if (firebase.isInvalidCredentials(err)) return fail("E-mail ou senha inválidos.");
      if (err.code === "TOO_MANY_ATTEMPTS_TRY_LATER") return fail("Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429);
      throw err;
    }

    if (user.status === "bloqueado") return fail("Sua conta está bloqueada. Contate a administração.", 403);

    if (await firebase.isEmailVerified(fbSession.idToken)) {
      return renderLogin(res, "Seu e-mail já está confirmado. Pode entrar normalmente.", { email, next: formNext });
    }

    const last = user.verificationEmailSentAt ? user.verificationEmailSentAt.getTime() : 0;
    const elapsed = Date.now() - last;
    if (elapsed <= RESEND_COOLDOWN_MS) {
      const waitMinutes = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 60000));
      return info(`Já enviamos um link para ${user.email} há pouco. Confira a caixa de entrada e o spam; se não encontrar, peça outro em cerca de ${waitMinutes} min.`);
    }

    try {
      await firebase.sendVerificationEmail(fbSession.idToken);
    } catch (err) {
      console.error("Falha ao reenviar e-mail de verificação:", err.message);
      return fail("Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.", 502);
    }
    user.verificationEmailSentAt = new Date();
    await user.save();
    info(`Enviamos um novo link de confirmação para ${user.email}. Confira também o spam.`);
  } catch (err) {
    console.error(err);
    fail("Erro ao reenviar o e-mail. Tente novamente.", 500);
  }
});

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
    if (await accounts.isEmailTaken(email)) errors.email = "Este e-mail já está cadastrado.";
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
    const data = { name, email, password, emailHistory: [email] };
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
        await firebase.sendPasswordReset(user.firebaseEmail || email);
      }
    } catch (err) {
      console.error("Falha ao enviar e-mail de recuperação de senha:", err.message);
    }
  }

  res.render("forgot-password", { title: "Recuperar Senha", error: null, sent: true });
});

// ─── LOGIN / CADASTRO COM O GOOGLE ──────────────────────────────────────────
// O mesmo endereço de retorno atende dois usos, guardados na sessão:
//   "login"  entrar com o Google, ou criar a conta se o e-mail for de um
//            domínio permitido (ALLOWED_EMAIL_DOMAINS) e nunca usado;
//   "email"  trocar o e-mail da conta logada pelo da conta Google escolhida.
const GOOGLE_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

const GOOGLE_LOGIN_ERRORS = {
  blocked: ["Sua conta está bloqueada. Contate a administração.", 403],
  "other-google": ["Este e-mail está ligado a outra conta Google. Entre com a conta Google que você cadastrou.", 403],
  domain: [
    `Só é possível criar uma conta com e-mail do IFSul (${ALLOWED_EMAIL_DOMAINS.map((d) => "@" + d).join(" ou ")}). Se você já tem conta, entre com o e-mail ou a conta Google cadastrados nela.`,
    403,
  ],
  taken: ["Este e-mail já foi usado em uma conta que hoje usa outro e-mail. Entre com o e-mail atual dessa conta.", 403],
};

function beginGoogle(req, res, next, purpose, target) {
  const request = google.createAuthRequest(google.redirectUri(req));
  req.session.googleAuth = {
    purpose,
    next: target,
    userId: req.session.user ? req.session.user.id : null,
    state: request.state,
    nonce: request.nonce,
    verifier: request.verifier,
    createdAt: Date.now(),
  };
  req.session.save((err) => (err ? next(err) : res.redirect(request.url)));
}

router.get("/auth/google", (req, res, next) => {
  const target = safeNext(asString(req.query.next));
  if (req.session.user) return res.redirect(target);
  if (!google.isConfigured()) return renderLogin(res, "O login com o Google não está disponível no momento.", { status: 503 });
  beginGoogle(req, res, next, "login", target);
});

router.get("/auth/google/email", requireAuth, (req, res, next) => {
  if (!google.isConfigured()) return res.redirect("/profile?trocaEmail=indisponivel");
  beginGoogle(req, res, next, "email", "/profile");
});

router.get("/auth/google/callback", loginLimiter, asyncHandler(async (req, res) => {
  const saved = req.session.googleAuth;
  delete req.session.googleAuth;

  const purpose = saved ? saved.purpose : "login";
  const formNext = saved && saved.next && saved.next !== "/" && purpose === "login" ? saved.next : "";
  const failLogin = (message, status = 400) => renderLogin(res, message, { next: formNext, status });
  const fail = (message, code, status = 400) =>
    purpose === "email" ? res.redirect(`/profile?trocaEmail=${code}`) : failLogin(message, status);

  const state = asString(req.query.state);
  const stateOk =
    saved &&
    Date.now() - saved.createdAt < GOOGLE_AUTH_MAX_AGE_MS &&
    state.length === saved.state.length &&
    crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved.state));
  if (!stateOk) return failLogin("Não foi possível concluir o login com o Google. Tente novamente.");

  // A pessoa cancelou na tela do Google.
  if (req.query.error) {
    return purpose === "email" ? res.redirect("/profile?trocaEmail=cancelado") : failLogin("Login com o Google cancelado.", 200);
  }

  let profile;
  try {
    profile = await google.fetchProfile({
      code: asString(req.query.code),
      verifier: saved.verifier,
      nonce: saved.nonce,
      redirectUri: google.redirectUri(req),
    });
  } catch (err) {
    if (err instanceof google.GoogleAuthError && err.code === "unverified") {
      return fail("O Google informou que o e-mail dessa conta não foi verificado.", "erro");
    }
    console.error("Falha no login com o Google:", err.message);
    return fail("Não foi possível entrar com o Google. Tente novamente.", "erro", 502);
  }

  if (purpose === "email") {
    // Só vale se for a mesma pessoa que iniciou o pedido, ainda logada.
    if (!req.session.user || req.session.user.id !== saved.userId) return res.redirect("/login");
    const user = await User.findById(saved.userId);
    if (!user) return res.redirect("/login");

    const result = await accounts.changeEmailWithGoogle(user, profile);
    if (result.error === "same") return res.redirect("/profile?trocaEmail=igual");
    if (result.error === "taken") return res.redirect("/profile?trocaEmail=em-uso");
    req.session.user.email = user.email;
    return res.redirect("/profile?trocaEmail=ok");
  }

  let result;
  try {
    result = await accounts.resolveGoogleLogin(profile);
  } catch (err) {
    if (err && err.code === 11000) return failLogin("Não foi possível entrar com o Google. Tente novamente.", 409);
    throw err;
  }
  if (result.error) {
    const [message, status] = GOOGLE_LOGIN_ERRORS[result.error];
    return failLogin(message, status);
  }

  await startSession(req, result.user);
  res.redirect(safeNext(saved.next));
}));

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
