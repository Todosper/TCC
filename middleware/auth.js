const Notification = require("../models/Notification");
// [DESATIVADO] O model User aqui era usado apenas pela checagem de e-mail
// verificado, fluxo desligado por não termos domínio próprio para o Resend.
// Mantido no require comentado para a reativação futura.
// const User = require("../models/User");

async function attachUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.loggedIn    = !!req.session.user;
  res.locals.isAdmin     = !!(req.session.user && req.session.user.isAdmin);
  res.locals.unreadCount = 0;
  // [DESATIVADO] Verificação de e-mail retirada por falta de domínio próprio
  // (envio via Resend impossibilitado). Todos são tratados como verificados
  // para que o banner nunca apareça. Lógica original mantida abaixo, dentro
  // do try/catch comentado, para reativação futura.
  res.locals.emailVerified = true; // default neutro para visitantes não logados (não exibe aviso)
  if (req.session.user) {
    try {
      const unreadCount = await Notification.countDocuments({ recipient: req.session.user.id, read: false });
      res.locals.unreadCount = unreadCount;
      // const [unreadCount, freshUser] = await Promise.all([
      //   Notification.countDocuments({ recipient: req.session.user.id, read: false }),
      //   // Consultado a cada request (não fica só na sessão) para refletir a
      //   // verificação assim que ela acontecer, sem exigir novo login.
      //   User.findById(req.session.user.id).select("emailVerified"),
      // ]);
      // res.locals.unreadCount = unreadCount;
      // res.locals.emailVerified = freshUser ? freshUser.emailVerified : true;
    } catch (e) {
      res.locals.unreadCount = 0;
    }
  }
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

module.exports = { attachUser, requireAuth, requireAdmin };
