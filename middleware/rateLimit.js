const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// Limite para tentativas de login: poucas tentativas por IP a cada 15 minutos.
// Objetivo: dificultar força bruta de senha sem travar um usuário comum que
// erra a senha uma ou duas vezes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render("login", {
      title: "Entrar",
      error: "Muitas tentativas de login a partir deste dispositivo. Aguarde alguns minutos e tente novamente.",
    });
  },
});

// Limite para criação de contas por IP — dificulta criação massiva de contas
// por scripts/bots sem impedir o uso normal.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render("register", {
      title: "Criar Conta",
      errors: { general: "Muitas contas criadas a partir deste endereço em pouco tempo. Tente novamente mais tarde." },
      form: req.body,
      done: false,
    });
  },
});

// Limite para criação de conteúdo (tópicos, respostas, sugestões) — conta por
// usuário autenticado (não por IP), para não punir várias pessoas atrás do
// mesmo IP (ex.: mesma rede do Campus/NAT) e para de fato conter um usuário
// específico que tente floodar o fórum.
const contentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.session.user ? req.session.user.id : ipKeyGenerator(req.ip)),
  handler: (req, res) => {
    res.status(429).send("Você atingiu o limite de publicações neste período. Aguarde alguns minutos e tente novamente.");
  },
});

module.exports = { loginLimiter, registerLimiter, contentLimiter };
