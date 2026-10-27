const crypto = require("crypto");
const { doubleCsrf } = require("csrf-csrf");

// Proteção CSRF via padrão "double submit cookie": um cookie com o segredo +
// um token derivado dele é exigido em todo POST/PUT/PATCH/DELETE. Isso impede
// que uma página maliciosa em outro site consiga disparar uma ação em nome de
// um usuário/admin logado só porque o cookie de sessão é enviado
// automaticamente pelo navegador.
//
// A biblioteca amarra o token a um "identificador de sessão". Aqui o
// identificador é um valor aleatório guardado em um cookie próprio, em vez do
// id da sessão do express-session: como a sessão só é gravada depois do login
// (saveUninitialized: false), o id dela mudaria a cada requisição de quem ainda
// não está logado, e os formulários de login e cadastro nunca validariam. O
// cookie próprio é estável antes do login e não cria sessões no banco para
// visitantes anônimos.
const CSRF_IDENTIFIER_COOKIE = "csrf_id";

function getOrCreateCsrfIdentifier(req, res) {
  // attachCsrfToken e doubleCsrfProtection podem chamar esta função na mesma
  // requisição; o id é guardado em `req` para não gerar dois cookies diferentes.
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
  // A biblioteca só passa `req` a esta função; `req.res` dá acesso à resposta
  // para criar o cookie do identificador quando ele ainda não existe.
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
  // O token chega no campo oculto "_csrf" dos formulários (views/partials/
  // csrf-field.ejs) ou, nas chamadas fetch, no cabeçalho "x-csrf-token".
  getCsrfTokenFromRequest: (req) => (req.body && req.body._csrf) || req.headers["x-csrf-token"],
});

// Garante que o identificador CSRF já existe antes da biblioteca rodar, tanto
// em GET (para gerar o token da página) quanto em POST (para validar).
function doubleCsrfProtection(req, res, next) {
  getOrCreateCsrfIdentifier(req, res);
  _doubleCsrfProtection(req, res, next);
}

// Disponibiliza `csrfToken` em toda view EJS para os formulários.
function attachCsrfToken(req, res, next) {
  res.locals.csrfToken = generateCsrfToken(req, res);
  next();
}

module.exports = { doubleCsrfProtection, attachCsrfToken, invalidCsrfTokenError };
