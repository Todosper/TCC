const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const Topic = require("../models/Topic");
const Comment = require("../models/Comment");
const Faq = require("../models/Faq");
const FaqCategory = require("../models/FaqCategory");
const User = require("../models/User");
const Suggestion = require("../models/Suggestion");
const { CATEGORIES, catLabel, catCls } = require("../models/categories");

// ─── HOME ───────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const recentTopicsRaw = await Topic.find().sort({ createdAt: -1 }).limit(4);
    const faqs = await Faq.find().populate("category").limit(4);

    const [userCount, topicCount, commentCount, faqCount] = await Promise.all([
      User.countDocuments(),
      Topic.countDocuments(),
      Comment.countDocuments(),
      Faq.countDocuments(),
    ]);

    // Conta respostas de cada tópico recente
    const recentTopics = [];
    for (const t of recentTopicsRaw) {
      const replies = await Comment.countDocuments({ topic: t._id });
      const obj = t.toObject({ virtuals: true });
      obj.replies = replies;
      obj.createdAt = t.createdAt; // garante o Date original p/ toLocaleDateString na view
      recentTopics.push(obj);
    }

    res.render("home", {
      title: "Início",
      recentTopics,
      faqs,
      stats: { userCount, topicCount, commentCount, faqCount },
      catLabel,
      catCls,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar a página inicial.");
  }
});

// ─── FORUM (lista) ──────────────────────────────────────────────────────────
router.get("/forum", async (req, res) => {
  try {
    const { q, cat, sort } = req.query;
    const filter = {};
    if (cat) filter.category = cat;
    if (q) filter.title = { $regex: q, $options: "i" };

    let query = Topic.find(filter);
    if (sort === "popular") query = query.sort({ views: -1 });
    else query = query.sort({ createdAt: -1 });

    const topicsRaw = await query;

    const topics = [];
    for (const t of topicsRaw) {
      const replyCount = await Comment.countDocuments({ topic: t._id });
      const obj = t.toObject({ virtuals: true });
      obj.replyCount = replyCount;
      obj.createdAt = t.createdAt;
      topics.push(obj);
    }

    res.render("forum", {
      title: "Fórum de Discussões",
      topics,
      categories: CATEGORIES,
      catLabel,
      catCls,
      query: q || "",
      selCat: cat || "",
      sort: sort || "recent",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar o fórum.");
  }
});

// ─── CREATE TOPIC ───────────────────────────────────────────────────────────
router.get("/forum/novo", requireAuth, (req, res) => {
  res.render("create-topic", { title: "Criar Novo Tópico", categories: CATEGORIES, errors: {}, form: {} });
});

router.post("/forum/novo", requireAuth, async (req, res) => {
  const { title, category, body } = req.body;
  const errors = {};

  if (!title || !title.trim()) errors.title = "Título obrigatório.";
  else if (title.trim().length < 10) errors.title = "Título deve ter ao menos 10 caracteres.";
  if (!category) errors.category = "Selecione uma categoria.";
  if (!body || body.trim().length < 30) errors.body = "Descrição deve ter ao menos 30 caracteres.";

  if (Object.keys(errors).length > 0) {
    return res.render("create-topic", {
      title: "Criar Novo Tópico",
      categories: CATEGORIES,
      errors,
      form: req.body,
    });
  }

  try {
    await Topic.create({
      title: title.trim(),
      category,
      content: body.trim(),
      author: req.session.user.id,
      authorName: req.session.user.name,
      tags: [],
    });
    res.redirect("/forum");
  } catch (err) {
    console.error(err);
    res.render("create-topic", {
      title: "Criar Novo Tópico",
      categories: CATEGORIES,
      errors: { general: "Erro ao publicar tópico." },
      form: req.body,
    });
  }
});

// ─── TOPIC DETAIL ───────────────────────────────────────────────────────────
router.get("/forum/topico/:id", async (req, res) => {
  try {
    const topic = await Topic.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!topic) return res.status(404).render("404", { title: "Não encontrado" });

    const comments = await Comment.find({ topic: topic._id }).sort({ createdAt: 1 });

    res.render("topic-detail", {
      title: topic.title,
      topic,
      comments,
      catLabel,
      catCls,
      replyError: null,
      submitted: req.query.submitted === "1",
    });
  } catch (err) {
    console.error(err);
    res.status(404).render("404", { title: "Não encontrado" });
  }
});

router.post("/forum/topico/:id/responder", requireAuth, async (req, res) => {
  try {
    const topic = await Topic.findById(req.params.id);
    if (!topic) return res.status(404).render("404", { title: "Não encontrado" });

    if (topic.locked) return res.redirect(`/forum/topico/${topic._id}`);

    const { text } = req.body;
    if (!text || text.trim().length < 10) {
      const comments = await Comment.find({ topic: topic._id }).sort({ createdAt: 1 });
      return res.render("topic-detail", {
        title: topic.title,
        topic,
        comments,
        catLabel,
        catCls,
        replyError: "A resposta deve ter ao menos 10 caracteres.",
        submitted: false,
      });
    }

    await Comment.create({
      topic: topic._id,
      author: req.session.user.id,
      authorName: req.session.user.name,
      authorRole: req.session.user.isAdmin ? "Staff" : req.session.user.role === "professor" ? "Professor(a)" : "Estudante",
      text: text.trim(),
    });

    res.redirect(`/forum/topico/${topic._id}?submitted=1`);
  } catch (err) {
    console.error(err);
    res.redirect(`/forum/topico/${req.params.id}`);
  }
});

// ─── FAQ ────────────────────────────────────────────────────────────────────
router.get("/faq", async (req, res) => {
  try {
    const { q, cat } = req.query;
    const categories = await FaqCategory.find();

    const filter = {};
    if (cat) filter.category = cat;
    if (q) {
      filter.$or = [
        { question: { $regex: q, $options: "i" } },
        { answer: { $regex: q, $options: "i" } },
      ];
    }

    const faqs = await Faq.find(filter).populate("category");

    // Contagem de perguntas por categoria (para os cards)
    const allFaqs = await Faq.find().populate("category");
    const counts = {};
    allFaqs.forEach((f) => {
      const id = f.category._id.toString();
      counts[id] = (counts[id] || 0) + 1;
    });

    res.render("faq", {
      title: "FAQ",
      faqs,
      categories,
      counts,
      query: q || "",
      selCat: cat || "",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar o FAQ.");
  }
});

// ─── SUGESTÕES PARA O CAMPUS ───────────────────────────────────────────────
router.get("/sugestoes", async (req, res) => {
  try {
    const suggestions = await Suggestion.find({ moderationStatus: "approved" })
      .sort({ publishedAt: -1, createdAt: -1 })
      .lean();
    const currentUserId = req.session.user ? String(req.session.user.id) : null;
    suggestions.forEach((suggestion) => {
      suggestion.supportCount = suggestion.votes.length;
      suggestion.hasSupported = !!currentUserId && suggestion.votes.some((vote) => String(vote.user) === currentUserId);
    });
    res.render("suggestions", { title: "Sugestões para o Campus", suggestions, submitted: req.query.enviada === "1" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar as sugestões.");
  }
});

router.get("/sugestoes/nova", requireAuth, (req, res) => {
  res.render("create-suggestion", { title: "Enviar sugestão", errors: {}, form: {} });
});

router.post("/sugestoes/nova", requireAuth, async (req, res) => {
  const { title, description, identity } = req.body;
  const errors = {};
  if (!title || !title.trim()) errors.title = "Título obrigatório.";
  else if (title.trim().length < 10) errors.title = "Título deve ter ao menos 10 caracteres.";
  if (!description || !description.trim()) errors.description = "Descrição obrigatória.";
  else if (description.trim().length < 30) errors.description = "Descrição deve ter ao menos 30 caracteres.";
  if (identity !== "named" && identity !== "anonymous") errors.identity = "Selecione como deseja publicar.";

  if (Object.keys(errors).length) {
    return res.render("create-suggestion", { title: "Enviar sugestão", errors, form: req.body });
  }

  try {
    await Suggestion.create({
      title: title.trim(),
      description: description.trim(),
      author: req.session.user.id,
      authorName: req.session.user.name,
      isAnonymous: identity === "anonymous",
    });
    res.redirect("/sugestoes?enviada=1");
  } catch (err) {
    console.error(err);
    res.render("create-suggestion", {
      title: "Enviar sugestão",
      errors: { general: "Não foi possível enviar sua sugestão. Tente novamente." },
      form: req.body,
    });
  }
});

router.post("/sugestoes/:id/apoio", requireAuth, async (req, res) => {
  try {
    const suggestion = await Suggestion.findOne({ _id: req.params.id, moderationStatus: "approved" });
    if (!suggestion) return res.status(404).render("404", { title: "Não encontrado" });

    const userId = String(req.session.user.id);
    const voteIndex = suggestion.votes.findIndex((vote) => String(vote.user) === userId);
    if (voteIndex === -1) suggestion.votes.push({ user: req.session.user.id });
    else suggestion.votes.splice(voteIndex, 1);
    await suggestion.save();
    res.redirect("/sugestoes");
  } catch (err) {
    console.error(err);
    res.redirect("/sugestoes");
  }
});

module.exports = router;
