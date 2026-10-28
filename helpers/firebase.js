// Integração com o Firebase Authentication.
//
// As operações de login, cadastro, verificação de e-mail e redefinição de senha
// usam a API REST (Identity Toolkit) e precisam apenas da "Chave de API da Web"
// do projeto (FIREBASE_API_KEY), que é um identificador público. Já a exclusão
// de contas usa o Firebase Admin SDK, que exige a conta de serviço em
// FIREBASE_SERVICE_ACCOUNT (secreta; veja abaixo).
//
// Os dados do site (nome, perfil, tópicos etc.) ficam no MongoDB. O Firebase
// guarda apenas e-mail e senha de quem tem conta vinculada.
//
// Usa o fetch nativo do Node 18+.

const BASE_URL = "https://identitytoolkit.googleapis.com/v1/accounts";

class FirebaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "FirebaseError";
    this.code = code; // ex.: EMAIL_EXISTS, INVALID_LOGIN_CREDENTIALS
  }
}

// Códigos que o Firebase devolve quando e-mail ou senha estão errados.
const INVALID_CREDENTIAL_CODES = ["INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND"];

function isInvalidCredentials(err) {
  return !!err && INVALID_CREDENTIAL_CODES.includes(err.code);
}

function isConfigured() {
  return !!process.env.FIREBASE_API_KEY;
}

async function call(endpoint, body) {
  const res = await fetch(`${BASE_URL}:${endpoint}?key=${encodeURIComponent(process.env.FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Faz o Firebase enviar o e-mail em português.
      "X-Firebase-Locale": "pt-BR",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // O Firebase devolve algo como "WEAK_PASSWORD : Password should be ..."
    const raw = (data && data.error && data.error.message) || "UNKNOWN";
    throw new FirebaseError(String(raw).split(" : ")[0].trim());
  }
  return data;
}

// Cria a conta no Firebase. Retorna { idToken, localId (uid), ... }.
function signUp(email, password) {
  return call("signUp", { email, password, returnSecureToken: true });
}

// Autentica no Firebase. Lança FirebaseError se as credenciais forem inválidas.
function signIn(email, password) {
  return call("signInWithPassword", { email, password, returnSecureToken: true });
}

// Pergunta ao Firebase se o e-mail do usuário já foi verificado.
async function isEmailVerified(idToken) {
  const data = await call("lookup", { idToken });
  return !!(data.users && data.users[0] && data.users[0].emailVerified);
}

// Troca a senha de um usuário já autenticado (idToken vem de signIn/signUp).
function changePassword(idToken, newPassword) {
  return call("update", { idToken, password: newPassword, returnSecureToken: true });
}

// Envia o e-mail (quem envia é o Firebase). O link leva à página de ação
// hospedada pelo próprio Firebase; "continueUrl" cria o botão de voltar ao site.
// Se o domínio do site ainda não estiver em "Domínios autorizados" no console,
// o Firebase recusa o continueUrl — nesse caso reenviamos sem ele, para o e-mail
// sair do mesmo jeito.
async function sendOob(body) {
  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  if (appUrl) {
    try {
      return await call("sendOobCode", { ...body, continueUrl: `${appUrl}/login` });
    } catch (err) {
      if (!/CONTINUE_URI|UNAUTHORIZED_DOMAIN/.test(err.code)) throw err;
      console.warn(`⚠️  Firebase recusou o continueUrl (${err.code}). Adicione o domínio do site em Authentication > Settings > Authorized domains.`);
    }
  }
  return call("sendOobCode", body);
}

function sendVerificationEmail(idToken) {
  return sendOob({ requestType: "VERIFY_EMAIL", idToken });
}

function sendPasswordReset(email) {
  return sendOob({ requestType: "PASSWORD_RESET", email });
}

// ── Exclusão de contas (Admin SDK) ──────────────────────────────────────────
// Apagar uma conta sem saber a senha dela exige credencial de administrador: a
// "conta de serviço" do projeto, colada inteira (JSON) em
// FIREBASE_SERVICE_ACCOUNT. É secreta: só deve ficar em variável de ambiente,
// nunca no código nem no GitHub. O SDK só é carregado quando esta função é usada.
let adminAuth = null;

function isAdminConfigured() {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT;
}

function getAdminAuth() {
  if (adminAuth) return adminAuth;
  // API modular do Admin SDK (as versões novas não têm mais `admin.apps`).
  const { getApps, getApp, initializeApp, cert } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const app = getApps().length ? getApp() : initializeApp({ credential: cert(credentials) });
  adminAuth = getAuth(app);
  return adminAuth;
}

// Troca o e-mail da conta no Firebase (Admin SDK). Só é usado depois de o
// Google ter confirmado que a pessoa é dona do novo e-mail.
async function updateUserEmail(uid, email) {
  await getAdminAuth().updateUser(uid, { email, emailVerified: true });
}

// Apaga a conta no Firebase. Se ela já não existir lá, considera sucesso.
async function deleteUser(uid) {
  try {
    await getAdminAuth().deleteUser(uid);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return;
    throw err;
  }
}

module.exports = {
  FirebaseError,
  isConfigured,
  isInvalidCredentials,
  isAdminConfigured,
  deleteUser,
  updateUserEmail,
  signUp,
  signIn,
  isEmailVerified,
  changePassword,
  sendVerificationEmail,
  sendPasswordReset,
};
