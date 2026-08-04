const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middleware/auth");
const User = require("../models/User");
const Topic = require("../models/Topic");
const Comment = require("../models/Comment");
const Faq = require("../models/Faq");
const FaqCategory = require("../models/FaqCategory");
const Suggestion = require("../models/Suggestion");
const { CATEGORIES, catLabel, catCls } = require("../models/categories");

router.use(requireAdmin);

// ─── DASHBOARD ──────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const [userCount, topicCount, commentCount, faqCount, blockedCount, pendingSuggestionCount] = await Promise.all([
    User.countDocuments(),
    Topic.countDocuments(),
    Comment.countDocuments(),
    Faq.countDocuments(),
    User.countDocuments({ status: "bloqueado" }),
    Suggestion.countDocuments({ moderationStatus: "pending" }),
  ]);

  const recentTopics = await Topic.find().sort({ createdAt: -1 }).limit(3);
  const recentUsers = await User.find().sort({ createdAt: -1 }).limit(3);

  res.render("admin/dashboard", {
    title: "Painel Administrativo",
    tab: "dashboard",
    stats: { userCount, topicCount, commentCount, faqCount, blockedCount, pendingSuggestionCount },
    recentTopics,
    recentUsers,
  });
});

// ─── GERENCIAR FAQ ──────────────────────────────────────────────────────────
router.get("/faq", async (req, res) => {
  const faqs = await Faq.find().populate("category").sort({ createdAt: -1 });
  res.render("admin/faq", { title: "Gerenciar FAQ", tab: "faq", faqs });
});

router.get("/faq/novo", async (req, res) => {
  const categories = await FaqCategory.find();
  res.render("admin/faq-form", { title: "Nova Pergunta", tab: "faq", categories, faq: null, errors: {} });
});

router.post("/faq/novo", async (req, res) => {
  const { question, answer, category } = req.body;
  const errors = {};
  if (!question) errors.question = "Pergunta obrigatória.";
  if (!answer) errors.answer = "Resposta obrigatória.";
  if (!category) errors.category = "Selecione uma categoria.";

  if (Object.keys(errors).length > 0) {
    const categories = await FaqCategory.find();
    return res.render("admin/faq-form", { title: "Nova Pergunta", tab: "faq", categories, faq: req.body, errors });
  }

  await Faq.create({ question, answer, category });
  res.redirect("/admin/faq");
});

router.get("/faq/:id/editar", async (req, res) => {
  const faq = await Faq.findById(req.params.id);
  const categories = await FaqCategory.find();
  if (!faq) return res.redirect("/admin/faq");
  res.render("admin/faq-form", { title: "Editar Pergunta", tab: "faq", categories, faq, errors: {} });
});

router.post("/faq/:id/editar", async (req, res) => {
  const { question, answer, category } = req.body;
  await Faq.findByIdAndUpdate(req.params.id, { question, answer, category });
  res.redirect("/admin/faq");
});

router.post("/faq/:id/excluir", async (req, res) => {
  await Faq.findByIdAndDelete(req.params.id);
  res.redirect("/admin/faq");
});

// ─── MODERAR FÓRUM ──────────────────────────────────────────────────────────
router.get("/forum", async (req, res) => {
  const topics = await Topic.find().sort({ createdAt: -1 });
  res.render("admin/forum", { title: "Moderar Fórum", tab: "forum", topics, catLabel, catCls });
});

router.post("/forum/:id/toggle-lock", async (req, res) => {
  const topic = await Topic.findById(req.params.id);
  if (topic) {
    topic.locked = !topic.locked;
    await topic.save();
  }
  res.redirect("/admin/forum");
});

router.post("/forum/:id/excluir", async (req, res) => {
  await Topic.findByIdAndDelete(req.params.id);
  await Comment.deleteMany({ topic: req.params.id });
  res.redirect("/admin/forum");
});

// ─── MODERAR SUGESTÕES ─────────────────────────────────────────────────────
router.get("/sugestoes", async (req, res) => {
  const { filter = "pending" } = req.query;
  const query = filter === "all" ? {} : { moderationStatus: filter };
  const suggestions = await Suggestion.find(query).sort({ createdAt: -1 });
  res.render("admin/suggestions", { title: "Moderar Sugestões", tab: "suggestions", suggestions, filter });
});

router.get("/sugestoes/:id", async (req, res) => {
  const suggestion = await Suggestion.findById(req.params.id);
  if (!suggestion) return res.redirect("/admin/sugestoes");
  res.render("admin/suggestion-detail", { title: "Avaliar sugestão", tab: "suggestions", suggestion, errors: {} });
});

router.post("/sugestoes/:id/aprovar", async (req, res) => {
  await Suggestion.findByIdAndUpdate(req.params.id, {
    moderationStatus: "approved", publishedAt: new Date(), rejectionReason: "",
  });
  res.redirect("/admin/sugestoes");
});

router.post("/sugestoes/:id/rejeitar", async (req, res) => {
  const reason = (req.body.reason || "").trim();
  await Suggestion.findByIdAndUpdate(req.params.id, { moderationStatus: "rejected", rejectionReason: reason });
  res.redirect("/admin/sugestoes");
});

router.post("/sugestoes/:id/status", async (req, res) => {
  const { status, statusReason } = req.body;
  const validStatuses = ["analysis", "planned", "implemented", "not_implemented"];
  if (!validStatuses.includes(status)) return res.redirect(`/admin/sugestoes/${req.params.id}`);
  if (status === "not_implemented" && !(statusReason || "").trim()) {
    const suggestion = await Suggestion.findById(req.params.id);
    if (!suggestion) return res.redirect("/admin/sugestoes");
    return res.render("admin/suggestion-detail", {
      title: "Avaliar sugestão", tab: "suggestions", suggestion,
      errors: { statusReason: "Informe uma justificativa para este status." },
    });
  }
  await Suggestion.findByIdAndUpdate(req.params.id, {
    status,
    statusReason: status === "not_implemented" ? statusReason.trim() : "",
  });
  res.redirect(`/admin/sugestoes/${req.params.id}`);
});

router.post("/sugestoes/:id/excluir", async (req, res) => {
  await Suggestion.findByIdAndDelete(req.params.id);
  res.redirect("/admin/sugestoes");
});

// ─── USUÁRIOS ───────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  const { q } = req.query;
  const filter = q
    ? { $or: [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }] }
    : {};
  const users = await User.find(filter).sort({ createdAt: -1 });
  res.render("admin/users", { title: "Usuários", tab: "users", users, query: q || "" });
});

router.post("/users/:id/toggle-status", async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user) {
    user.status = user.status === "ativo" ? "bloqueado" : "ativo";
    await user.save();
  }
  res.redirect("/admin/users");
});

router.post("/users/:id/toggle-curator", async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user && !user.isAdmin) {
    user.isCurator = !user.isCurator;
    await user.save();
  }
  res.redirect("/admin/users");
});

router.post("/users/:id/excluir", async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.redirect("/admin/users");
});

module.exports = router;
