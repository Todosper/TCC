const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const User = require("../models/User");
const firebase = require("../helpers/firebase");

// asyncHandler: sem try/catch aqui, uma falha no banco (ou usuário inexistente)
// virava uma Promise rejeitada sem tratamento — que derrubava o processo.
router.get("/profile", requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.user.id);
  if (!user) return res.redirect("/login");
  res.render("profile", {
    title: "Meu Perfil",
    user,
    tab: req.query.tab === "pw" ? "pw" : "info",
    saved: req.query.saved === "1",
    pwSaved: req.query.pwSaved === "1",
    errors: {},
  });
}));

router.post("/profile/info", requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findById(req.session.user.id);
    user.name = name;
    // Em contas vinculadas ao Firebase, o e-mail é a identidade verificada e
    // não pode ser trocado por aqui (senão pularia a verificação).
    if (!user.firebaseUid) user.email = email;
    await user.save();

    req.session.user.name = user.name;
    req.session.user.email = user.email;

    res.redirect("/profile?saved=1");
  } catch (err) {
    console.error(err);
    res.redirect("/profile");
  }
});

router.post("/profile/senha", requireAuth, async (req, res) => {
  try {
    const { current, next, confirm } = req.body;
    const user = await User.findById(req.session.user.id);

    // Conta vinculada ao Firebase: a senha atual é conferida lá (é a fonte da
    // verdade). Conta antiga: bcrypt, como sempre.
    const useFirebase = !!user.firebaseUid && firebase.isConfigured();
    let fbSession = null;
    let match;
    if (useFirebase) {
      try {
        fbSession = await firebase.signIn(user.email, current);
        match = true;
      } catch (err) {
        if (!["INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND"].includes(err.code)) throw err;
        match = false;
      }
    } else {
      match = await user.comparePassword(current);
    }
    if (!match) {
      return res.render("profile", {
        title: "Meu Perfil",
        user,
        tab: "pw",
        saved: false,
        pwSaved: false,
        errors: { current: "Senha atual incorreta." },
      });
    }
    if (!next || next.length < 8) {
      return res.render("profile", {
        title: "Meu Perfil",
        user,
        tab: "pw",
        saved: false,
        pwSaved: false,
        errors: { next: "A nova senha deve ter ao menos 8 caracteres." },
      });
    }
    if (next !== confirm) {
      return res.render("profile", {
        title: "Meu Perfil",
        user,
        tab: "pw",
        saved: false,
        pwSaved: false,
        errors: { confirm: "As senhas não coincidem." },
      });
    }

    if (fbSession) await firebase.changePassword(fbSession.idToken, next);

    user.password = next;
    await user.save();

    res.redirect("/profile?tab=pw&pwSaved=1");
  } catch (err) {
    console.error(err);
    res.redirect("/profile?tab=pw");
  }
});

module.exports = router;
