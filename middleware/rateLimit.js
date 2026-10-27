const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const { wantsJson } = require("../helpers/http");

// Tentativas de login: poucas por IP a cada 15 minutos, para dificultar força
// bruta de senha sem travar quem erra a senha uma ou duas vezes. Logins
// bem-sucedidos não entram na conta: a rota responde com status 401 quando as
// credenciais estão erradas (ver routes/auth.js), e só respostas com status de
// erro contam.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).render("login", {
      title: "Entrar",
      error: "Muitas tentativas de login a partir deste dispositivo. Aguarde alguns minutos e tente novamente.",
      form: { next: typeof req.body?.next === "string" ? req.body.next : "" },
    });
  },
});

// Pedidos de recuperação de senha enviam e-mail, então têm limite próprio e
// separado do login.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render("forgot-password", {
      title: "Recuperar Senha",
      error: "Muitos pedidos de recuperação de senha. Aguarde alguns minutos e tente novamente.",
      sent: false,
    });
  },
});

// Criação de contas por IP, para dificultar cadastros em massa por scripts.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const body = req.body || {};
    res.status(429).render("register", {
      title: "Criar Conta",
      errors: { general: "Muitas contas criadas a partir deste endereço em pouco tempo. Tente novamente mais tarde." },
      form: { name: typeof body.name === "string" ? body.name : "", email: typeof body.email === "string" ? body.email : "" },
      done: false,
    });
  },
});

// Criação de conteúdo (tópicos, respostas, sugestões, denúncias). Conta por
// usuário autenticado e não por IP, para não punir várias pessoas na mesma
// rede (ex.: Wi-Fi do Campus) e para conter quem tente inundar o fórum.
const contentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.session.user ? req.session.user.id : ipKeyGenerator(req.ip)),
  handler: (req, res) => {
    const message = "Você atingiu o limite de publicações neste período. Aguarde alguns minutos e tente novamente.";
    if (wantsJson(req)) return res.status(429).json({ error: message });
    res.status(429).render("429", { title: "Muitas ações em pouco tempo", message });
  },
});

module.exports = { loginLimiter, forgotLimiter, registerLimiter, contentLimiter };
