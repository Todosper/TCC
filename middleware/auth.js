function attachUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.loggedIn    = !!req.session.user;
  res.locals.isAdmin     = !!(req.session.user && req.session.user.isAdmin);
  res.locals.isCurator   = !!(req.session.user && (req.session.user.isCurator || req.session.user.isAdmin));
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

function requireCurator(req, res, next) {
  if (!req.session.user || (!req.session.user.isCurator && !req.session.user.isAdmin)) {
    return res.status(403).render("403", { title: "Acesso negado" });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin, requireCurator };
