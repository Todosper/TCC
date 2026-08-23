const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const User = require("../models/User");

router.get("/profile", requireAuth, async (req, res) => {
  const user = await User.findById(req.session.user.id);
  res.render("profile", {
    title: "Meu Perfil",
    user,
    tab: req.query.tab === "pw" ? "pw" : "info",
    saved: req.query.saved === "1",
    pwSaved: req.query.pwSaved === "1",
    errors: {},
  });
});

router.post("/profile/info", requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findById(req.session.user.id);
    user.name = name;
    user.email = email;
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

    const match = await user.comparePassword(current);
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

    user.password = next;
    await user.save();

    res.redirect("/profile?tab=pw&pwSaved=1");
  } catch (err) {
    console.error(err);
    res.redirect("/profile?tab=pw");
  }
});

module.exports = router;
