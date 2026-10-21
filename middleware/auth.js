const Notification = require("../models/Notification");
const User = require("../models/User");

// ─── Estado da conta (cache curto) ──────────────────────────────────────────
// A sessão guarda { id, name, role, isAdmin } do momento do login e vale por 7
// dias. Sem conferir o banco, um usuário BLOQUEADO continuava logado e
// publicando, um admin REBAIXADO mantinha os poderes de admin, e uma conta
// EXCLUÍDA continuava com sessão válida. Por isso o estado atual da conta é
// consultado a cada requisição autenticada — mas com um cache de poucos
// segundos (e invalidação imediata quando um admin altera a conta, ver
// invalidateUserCache) para não gerar uma consulta extra a cada clique.
const ACCOUNT_CACHE_TTL_MS = 20 * 1000;
const ACCOUNT_CACHE_MAX = 5000;
const accountCache = new Map();

function invalidateUserCache(userId) {
  if (userId) accountCache.delete(String(userId));
}

// Retorna { status, isAdmin, role } da conta, ou null se ela não existe mais.
async function loadAccountState(userId) {
  const key = String(userId);
  const hit = accountCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.state;

  const doc = await User.findById(key).select("status isAdmin role").lean();
  const state = doc ? { status: doc.status, isAdmin: !!doc.isAdmin, role: doc.role } : null;

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

  // As duas consultas são independentes: rodam em paralelo. Se a checagem da
  // conta falhar (ex.: oscilação do banco), mantém a sessão como estava em vez
  // de deslogar todo mundo por causa de um erro temporário.
  const [state, unreadCount] = await Promise.all([
    loadAccountState(sessionUser.id).catch(() => undefined),
    Notification.countDocuments({ recipient: sessionUser.id, read: false }).catch(() => 0),
  ]);

  if (state === null || (state && state.status === "bloqueado")) {
    // Conta excluída ou bloqueada: encerra o login desta sessão. No próximo
    // login o usuário bloqueado vê a mensagem de bloqueio normalmente.
    delete req.session.user;
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

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).render("403", { title: "Acesso negado" });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin, invalidateUserCache };
