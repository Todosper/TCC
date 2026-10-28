// Login com o Google (OAuth 2.0 / OpenID Connect, fluxo "authorization code"
// com PKCE). Não usa pacotes extras: só o fetch nativo do Node.
//
// Precisa de GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (criados em
// console.cloud.google.com > APIs e serviços > Credenciais). O endereço de
// retorno cadastrado lá deve ser  <URL do site>/auth/google/callback.
//
// O id_token é recebido direto do Google, por HTTPS, na troca do código. Por
// isso (como a documentação do Google permite) a assinatura dele não precisa
// ser conferida de novo; conferimos emissor, público, validade e nonce.

const crypto = require("crypto");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

class GoogleAuthError extends Error {
  constructor(code) {
    super(code);
    this.name = "GoogleAuthError";
    this.code = code; // "token", "invalid" ou "unverified"
  }
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Endereço para onde o Google devolve a pessoa depois do login.
function redirectUri(req) {
  const base = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/+$/, "")}/auth/google/callback`;
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

// Monta o endereço de login do Google e os segredos que precisam ser
// guardados na sessão até a pessoa voltar.
function createAuthRequest(uri) {
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: uri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Sempre deixa escolher a conta, para não entrar sem querer na que já
    // está aberta no navegador.
    prompt: "select_account",
  });
  return { url: `${AUTH_URL}?${params}`, state, nonce, verifier };
}

// Troca o código pelo perfil da pessoa: { sub, email, name }.
async function fetchProfile({ code, verifier, nonce, redirectUri: uri }) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: uri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.id_token !== "string") throw new GoogleAuthError("token");

  let claims;
  try {
    claims = JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64url").toString("utf8"));
  } catch (err) {
    throw new GoogleAuthError("invalid");
  }

  const valid =
    ISSUERS.includes(claims.iss) &&
    claims.aud === process.env.GOOGLE_CLIENT_ID &&
    typeof claims.exp === "number" && claims.exp * 1000 > Date.now() &&
    claims.nonce === nonce &&
    typeof claims.sub === "string" && claims.sub !== "";
  if (!valid) throw new GoogleAuthError("invalid");

  // O e-mail só vale se o próprio Google confirmou que a pessoa é dona dele.
  if (claims.email_verified !== true || typeof claims.email !== "string" || !claims.email) {
    throw new GoogleAuthError("unverified");
  }

  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: typeof claims.name === "string" ? claims.name.trim() : "",
  };
}

module.exports = { GoogleAuthError, isConfigured, redirectUri, createAuthRequest, fetchProfile };
