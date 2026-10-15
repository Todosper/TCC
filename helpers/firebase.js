// Integração com o Firebase Authentication via API REST (Identity Toolkit).
//
// Por que REST e não o SDK? Só precisamos de duas coisas do Firebase: ENVIAR
// os e-mails (verificação de conta e redefinição de senha) e confirmar se o
// e-mail foi verificado. Isso dispensa firebase-admin, conta de serviço e
// qualquer dependência nova — basta a "Chave de API da Web" do projeto, que é
// um identificador público (não é um segredo) e fica em FIREBASE_API_KEY.
//
// Os dados do site (nome, perfil, tópicos, etc.) continuam 100% no MongoDB.
// O Firebase guarda apenas e-mail + senha de quem tem conta vinculada.
//
// Usa o fetch nativo do Node 18+ (o server.js já depende disso).

const BASE_URL = "https://identitytoolkit.googleapis.com/v1/accounts";

class FirebaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "FirebaseError";
    this.code = code; // ex.: EMAIL_EXISTS, INVALID_LOGIN_CREDENTIALS
  }
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
// Apagar uma conta SEM saber a senha dela exige credencial de administrador:
// a "conta de serviço" do projeto, colada inteira (JSON) em
// FIREBASE_SERVICE_ACCOUNT. É secreta — só em variável de ambiente, nunca no
// código nem no GitHub. O SDK só é carregado quando esta função é usada.
let adminAuth = null;

function isAdminConfigured() {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT;
}

function getAdminAuth() {
  if (adminAuth) return adminAuth;
  const admin = require("firebase-admin");
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(credentials) });
  adminAuth = app.auth();
  return adminAuth;
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
  isAdminConfigured,
  deleteUser,
  signUp,
  signIn,
  isEmailVerified,
  changePassword,
  sendVerificationEmail,
  sendPasswordReset,
};
