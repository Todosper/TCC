const crypto = require("crypto");
const { doubleCsrf } = require("csrf-csrf");

// Proteção CSRF via padrão "double submit cookie": um cookie com o segredo +
// um token derivado dele é exigido em todo POST/PUT/PATCH/DELETE. Isso impede
// que uma página maliciosa em outro site consiga disparar uma ação em nome de
// um usuário/admin logado só porque o cookie de sessão é enviado
// automaticamente pelo navegador.
//
// IMPORTANTE (bug real encontrado e corrigido durante os testes): a
// biblioteca amarra o token a um "identificador de sessão" (getSessionIdentifier).
// A princípio usei req.session.id, mas a sessão do express-session aqui é
// configurada com saveUninitialized:false e só passa a ser persistida de
// verdade DEPOIS do login (routes/auth.js só grava req.session.user ali).
// Ou seja, para qualquer visitante ainda não logado — exatamente quem usa os
// formulários de login, cadastro e "esqueci senha" — o id da sessão mudava a
// cada requisição, e o token gerado no GET nunca validava no POST seguinte.
// Isso bloquearia login e cadastro de TODO MUNDO, não é um detalhe pequeno.
//
// A correção: usar um identificador próprio, gerado uma única vez e guardado
// em um cookie dedicado (independente do cookie de sessão do app), estável
// mesmo antes do login e sem exigir saveUninitialized:true (que criaria uma
// sessão no MongoDB para todo visitante anônimo/bot, mesmo sem necessidade).
const CSRF_IDENTIFIER_COOKIE = "csrf_id";

function getOrCreateCsrfIdentifier(req, res) {
  // Evita gerar (e sobrescrever via Set-Cookie) um novo id duas vezes na
  // mesma requisição — attachCsrfToken e doubleCsrfProtection podem ambos
  // chamar esta função na mesma requisição GET.
  if (req._csrfIdentifier) return req._csrfIdentifier;

  let id = req.cookies[CSRF_IDENTIFIER_COOKIE];
  if (!id) {
    id = crypto.randomBytes(32).toString("hex");
    res.cookie(CSRF_IDENTIFIER_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias, alinhado ao cookie de sessão
    });
  }
  req._csrfIdentifier = id;
  return id;
}

const { doubleCsrfProtection: _doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET,
  // getSessionIdentifier só recebe `req` na assinatura da lib; usamos
  // req.res (referência padrão e sempre presente que o próprio Express monta
  // entre req/res) para poder setar o cookie de identificador quando ainda
  // não existir, sem depender de estado externo.
  getSessionIdentifier: (req) => getOrCreateCsrfIdentifier(req, req.res),
  cookieName: "csrf_token",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  size: 64,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  // O padrão da biblioteca só procura o token no header "x-csrf-token", que
  // faz sentido para chamadas via fetch/AJAX. Este projeto usa formulários
  // HTML tradicionais (<form method="POST">), então o token chega no corpo
  // da requisição, no campo oculto "_csrf" (ver views/partials/csrf-field.ejs).
  getCsrfTokenFromRequest: (req) => req.body && req.body._csrf,
});

// Garante que o identificador CSRF (cookie próprio, independente da sessão)
// já existe ANTES da lib rodar, tanto em GET (para gerar o token da página)
// quanto em POST (para validar) — evita qualquer ambiguidade de ordem.
function doubleCsrfProtection(req, res, next) {
  getOrCreateCsrfIdentifier(req, res);
  _doubleCsrfProtection(req, res, next);
}

// Disponibiliza `csrfToken` em toda view EJS, para que os formulários
// consigam incluir o campo oculto sem cada rota precisar gerar isso na mão.
function attachCsrfToken(req, res, next) {
  res.locals.csrfToken = generateCsrfToken(req, res);
  next();
}

module.exports = { doubleCsrfProtection, attachCsrfToken, invalidCsrfTokenError };
