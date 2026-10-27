const express = require("express");
const router = express.Router();

// Páginas informativas (sem acesso ao banco).
router.get("/acessibilidade", (req, res) => {
  res.render("accessibility-statement", { title: "Acessibilidade" });
});

router.get("/privacidade", (req, res) => {
  res.render("privacy", { title: "Privacidade e termos de uso" });
});

module.exports = router;
