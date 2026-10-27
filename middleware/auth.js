const Notification = require("../models/Notification");
const User = require("../models/User");
const { safeNext } = require("../helpers/redirect");

// ─── Estado da conta (cache curto) ──────────────────────────────────────────
// A sessão guarda { id, name, role, isAdmin } do momento do login e vale por 7
// dias. Para que bloquear, rebaixar ou excluir uma conta, ou trocar a senha,
// tenha efeito imediato, o estado atual da conta é consultado a cada requisição
// autenticada. Um cache de poucos segundos evita uma consulta extra a cada
// clique; ele é limpo na hora quando o estado da conta muda (invalidateUserCache).
// O cache fica na memória do processo, o que basta para uma única instância.
const ACCOUNT_CACHE_TTL_MS = 20 * 1000;
const ACCOUNT_CACHE_MAX = 5000;
const accountCache = new Map();

function invalidateUserCache(userId) {
  if (userId) accountCache.delete(String(userId));
}

// Retorna { status, isAdmin, role, passwordChangedAt } da conta, ou null se ela não existe mais.
async function loadAccountState(userId) {
  const key = String(userId);
  const hit = accountCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.state;

  const doc = await User.findById(key).select("status isAdmin role passwordChangedAt").lean();
  const state = doc
    ? {
        status: doc.status,
        isAdmin: !!doc.isAdmin,
        role: doc.role,
        passwordChangedAt: doc.passwordChangedAt ? doc.passwordChangedAt.getTime() : 0,
      }
    : null;

  if (accountCache.size >= ACCOUNT_CACHE_MAX) accountCache.clear();
  accountCache.set(key, { state, expires: Date.now() + ACCOUNT_CACHE_TTL_MS });
  return state;
}

async function attachUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.loggedIn = false;
  res.locals.isAdmin = false;
  res.locals.unreadCount = 0;

  const sessionUser = req.session && req.session.user;
  if (!sessionUser) return next();

  // As duas consultas são independentes e rodam em paralelo. Se a checagem da
  // conta falhar (ex.: oscilação do banco), a sessão é mantida como estava em
  // vez de deslogar todo mundo por causa de um erro temporário.
  const [state, unreadCount] = await Promise.all([
    loadAccountState(sessionUser.id).catch(() => undefined),
    Notification.countDocuments({ recipient: sessionUser.id, read: false }).catch(() => 0),
  ]);

  // Encerra o login desta sessão quando a conta foi excluída ou bloqueada, ou
  // quando a senha foi trocada depois que esta sessão começou.
  const passwordChangedSince = state && state.passwordChangedAt && (req.session.authAt || 0) < state.passwordChangedAt;
  if (state === null || (state && state.status === "bloqueado") || passwordChangedSince) {
    delete req.session.user;
    delete req.session.authAt;
    return next();
  }

  if (state && (sessionUser.isAdmin !== state.isAdmin || sessionUser.role !== state.role)) {
    sessionUser.isAdmin = state.isAdmin;
    sessionUser.role = state.role;
  }

  res.locals.currentUser = sessionUser;
  res.locals.loggedIn = true;
  res.locals.isAdmin = !!sessionUser.isAdmin;
  res.locals.unreadCount = unreadCount;
  next();
}

// Redireciona para o login e, em pedidos GET, guarda a página desejada para
// voltar a ela depois de entrar.
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  const target = req.method === "GET" ? safeNext(req.originalUrl) : "/";
  res.redirect(target === "/" ? "/login" : `/login?next=${encodeURIComponent(target)}`);
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).render("403", { title: "Acesso negado" });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin, invalidateUserCache };
