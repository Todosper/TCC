const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const Topic = require("../models/Topic");
const Comment = require("../models/Comment");
const Faq = require("../models/Faq");
const FaqCategory = require("../models/FaqCategory");
const User = require("../models/User");
const Suggestion = require("../models/Suggestion");
const Report = require("../models/Report");
const { CATEGORIES, catLabel, catCls } = require("../models/categories");
const { createNotification } = require("../helpers/notifications");
const { buildSearchRegex } = require("../helpers/search");
const { queryString, isObjectIdString, paginate } = require("../helpers/query");
const { contentLimiter } = require("../middleware/rateLimit");

const PAGE_SIZE = 20; // tópicos por página no fórum

// Mesma regra do virtual `isRecent` do model Topic ("criado nas últimas 48h"),
// para as listagens que usam .lean() (objetos simples, sem virtuals).
const RECENT_MS = 1000 * 60 * 60 * 48;
function isRecent(createdAt) {
  if (!createdAt) return true;
  return Date.now() - new Date(createdAt).getTime() < RECENT_MS;
}

// Conta as respostas de vários tópicos em UMA consulta agregada (evita N+1).
async function getReplyCounts(topicIds) {
  if (topicIds.length === 0) return new Map();
  const rows = await Comment.aggregate([
    { $match: { topic: { $in: topicIds } } },
    { $group: { _id: "$topic", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}

// Campos que as listagens realmente exibem. Deixar de fora `content` (até 5000
// caracteres por tópico) e `tags` reduz bastante o volume lido do banco.
const TOPIC_LIST_FIELDS = "title category authorName locked createdAt views";

// ─── HOME ───────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    // Todas as consultas da home são independentes entre si e rodam em
    // paralelo (antes eram ~8 idas ao banco, uma depois da outra). Os totais
    // usam estimatedDocumentCount (lê só os metadados da coleção, sem varrer
    // documentos). A contagem de respostas dos tópicos recentes depende da
    // lista de tópicos, então é encadeada a ela — mas ainda em paralelo com o
    // resto.
    const recentTopicsPromise = Topic.find()
      .sort({ createdAt: -1 })
      .limit(4)
      .select(TOPIC_LIST_FIELDS)
      .lean()
      .then(async (topics) => {
        const replyCountMap = await getReplyCounts(topics.map((t) => t._id));
        return topics.map((t) => ({
          ...t,
          isRecent: isRecent(t.createdAt),
          replies: replyCountMap.get(t._id.toString()) || 0,
        }));
      });

    const [recentTopics, faqs, userCount, topicCount, commentCount, faqCount] = await Promise.all([
      recentTopicsPromise,
      // A home só mostra o texto da pergunta — não precisa de populate(category).
      Faq.find().select("question").limit(4).lean(),
      User.estimatedDocumentCount(),
      Topic.estimatedDocumentCount(),
      Comment.estimatedDocumentCount(),
      Faq.estimatedDocumentCount(),
    ]);

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
    // Parâmetros sempre como texto (ver helpers/query.js).
    const q = queryString(req.query.q);
    const cat = queryString(req.query.cat);
    const sort = queryString(req.query.sort);

    const filter = {};
    if (cat) filter.category = cat;
    if (q) filter.title = buildSearchRegex(q);

    // "Populares": desempata por data. Só por `views` há muitos empates (todo
    // tópico novo tem 0) e a paginação podia repetir/pular tópicos.
    const sortSpec = sort === "popular" ? { views: -1, createdAt: -1 } : { createdAt: -1 };

    // Paginação: contagem e página buscadas em paralelo.
    const { items: topicsRaw, totalPages, page: safePage } = await paginate({
      page: req.query.page,
      pageSize: PAGE_SIZE,
      count: () => Topic.countDocuments(filter),
      find: (skip, limit) => Topic.find(filter).sort(sortSpec).skip(skip).limit(limit).select(TOPIC_LIST_FIELDS).lean(),
    });

    const replyCountMap = await getReplyCounts(topicsRaw.map((t) => t._id));

    const topics = topicsRaw.map((t) => ({
      ...t,
      views: t.views || 0,
      isRecent: isRecent(t.createdAt),
      replyCount: replyCountMap.get(t._id.toString()) || 0,
    }));

    // Query string para os links de paginação preservarem os filtros ativos.
    const baseQueryParts = [];
    if (cat) baseQueryParts.push(`cat=${encodeURIComponent(cat)}`);
    if (q) baseQueryParts.push(`q=${encodeURIComponent(q)}`);
    if (sort && sort !== "recent") baseQueryParts.push(`sort=${encodeURIComponent(sort)}`);

    res.render("forum", {
      title: "Fórum de Discussões",
      topics,
      categories: CATEGORIES,
      catLabel,
      catCls,
      query: q,
      selCat: cat,
      sort: sort || "recent",
      page: safePage,
      totalPages,
      baseQuery: baseQueryParts.join("&"),
      basePath: "/forum",
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

router.post("/forum/novo", requireAuth, contentLimiter, async (req, res) => {
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
    // O tópico (com a visualização já contada) e os comentários não dependem
    // um do outro: buscados em paralelo. Um id inválido faz as duas consultas
    // falharem e cai no catch (404), como antes.
    const [topic, comments] = await Promise.all([
      Topic.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true }).lean(),
      Comment.find({ topic: req.params.id }).sort({ createdAt: 1 }).lean(),
    ]);
    if (!topic) return res.status(404).render("404", { title: "Não encontrado" });

    res.render("topic-detail", {
      title: topic.title,
      topic,
      comments,
      catLabel,
      catCls,
      replyError: null,
      submitted: req.query.submitted === "1",
      reported: req.query.reported === "1",
    });
  } catch (err) {
    console.error(err);
    res.status(404).render("404", { title: "Não encontrado" });
  }
});

router.post("/forum/topico/:id/responder", requireAuth, contentLimiter, async (req, res) => {
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
        reported: false,
      });
    }

    await Comment.create({
      topic: topic._id,
      author: req.session.user.id,
      authorName: req.session.user.name,
      authorRole: req.session.user.isAdmin ? "Staff" : req.session.user.role === "professor" ? "Professor(a)" : "Estudante",
      text: text.trim(),
    });

    const topicAuthorId = String(topic.author);
    if (topicAuthorId !== String(req.session.user.id)) {
      // Não precisa esperar: createNotification trata os próprios erros, e quem
      // respondeu não depende dela para ver a página.
      createNotification(
        topic.author,
        "forum_reply",
        `${req.session.user.name} respondeu ao seu tópico "${topic.title}"`,
        `/forum/topico/${topic._id}`
      );
    }

    res.redirect(`/forum/topico/${topic._id}?submitted=1`);
  } catch (err) {
    console.error(err);
    res.redirect(`/forum/topico/${req.params.id}`);
  }
});

// ─── DENÚNCIAS (fórum) ──────────────────────────────────────────────────────
// Permite a qualquer usuário autenticado sinalizar um tópico ou um comentário
// específico para revisão de um admin. Resolve P-29 da auditoria.
const REPORT_REASONS = ["spam", "offensive", "personal_info", "off_topic", "other"];

router.post("/forum/topico/:id/denunciar", requireAuth, contentLimiter, async (req, res) => {
  try {
    const topic = await Topic.findById(req.params.id);
    if (!topic) return res.status(404).render("404", { title: "Não encontrado" });

    const { reason, details, commentId } = req.body;
    if (!REPORT_REASONS.includes(reason)) {
      return res.redirect(`/forum/topico/${topic._id}`);
    }

    let comment = null;
    if (commentId) {
      comment = await Comment.findOne({ _id: commentId, topic: topic._id });
      if (!comment) return res.redirect(`/forum/topico/${topic._id}`);
    }

    // Evita que a mesma pessoa denuncie repetidamente o mesmo alvo (o
    // conteúdo já entra na fila do admin na primeira denúncia; denúncias
    // repetidas do mesmo autor não adicionam informação nova).
    const alreadyReported = await Report.findOne({
      reporter: req.session.user.id,
      topic: topic._id,
      comment: comment ? comment._id : null,
    });
    if (!alreadyReported) {
      await Report.create({
        targetType: comment ? "comment" : "topic",
        topic: topic._id,
        comment: comment ? comment._id : null,
        reporter: req.session.user.id,
        reason,
        details: (details || "").trim().slice(0, 500),
      });
    }

    res.redirect(`/forum/topico/${topic._id}?reported=1`);
  } catch (err) {
    console.error(err);
    res.redirect(`/forum/topico/${req.params.id}`);
  }
});

// ─── FAQ ────────────────────────────────────────────────────────────────────
router.get("/faq", async (req, res) => {
  try {
    const q = queryString(req.query.q);
    // Um id de categoria inválido (ex.: /faq?cat=abc) antes derrubava a página
    // com erro 500; agora é simplesmente ignorado.
    const cat = isObjectIdString(req.query.cat) ? req.query.cat : "";

    const filter = {};
    if (cat) filter.category = cat;
    if (q) {
      filter.$or = [
        { question: buildSearchRegex(q) },
        { answer: buildSearchRegex(q) },
      ];
    }

    // As três consultas são independentes e rodam em paralelo. A contagem por
    // categoria agora é feita pelo próprio banco (agregação) — antes o site
    // carregava TODAS as perguntas, com populate, só para contar.
    const [categories, faqs, countRows] = await Promise.all([
      FaqCategory.find().lean(),
      Faq.find(filter).select("question answer").lean(),
      Faq.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]),
    ]);

    const counts = {};
    countRows.forEach((row) => {
      if (row._id) counts[row._id.toString()] = row.n;
    });

    res.render("faq", {
      title: "FAQ",
      faqs,
      categories,
      counts,
      query: q,
      selCat: cat,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar o FAQ.");
  }
});

// ─── SUGESTÕES PARA O CAMPUS ───────────────────────────────────────────────
router.get("/sugestoes", async (req, res) => {
  try {
    const currentUserId = req.session.user ? String(req.session.user.id) : null;
    const userObjectId = isObjectIdString(currentUserId) ? new mongoose.Types.ObjectId(currentUserId) : null;

    // O total de apoios e "este usuário já apoiou?" são calculados pelo próprio
    // banco. Antes, a lista completa de votos de CADA sugestão era trazida para
    // o servidor só para contar e procurar o usuário — crescia a cada novo voto.
    // (Em $project, `false` seria lido como "excluir o campo"; por isso $literal.)
    const suggestions = await Suggestion.aggregate([
      { $match: { moderationStatus: "approved" } },
      { $sort: { publishedAt: -1, createdAt: -1 } },
      {
        $project: {
          title: 1,
          description: 1,
          status: 1,
          statusReason: 1,
          isAnonymous: 1,
          authorName: 1,
          publishedAt: 1,
          createdAt: 1,
          supportCount: { $size: { $ifNull: ["$votes", []] } },
          hasSupported: userObjectId
            ? { $in: [userObjectId, { $ifNull: ["$votes.user", []] }] }
            : { $literal: false },
        },
      },
    ]);

    res.render("suggestions", { title: "Sugestões para o Campus", suggestions, submitted: req.query.enviada === "1" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar as sugestões.");
  }
});

router.get("/sugestoes/nova", requireAuth, (req, res) => {
  res.render("create-suggestion", { title: "Enviar sugestão", errors: {}, form: {} });
});

router.post("/sugestoes/nova", requireAuth, contentLimiter, async (req, res) => {
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
    const userId = new mongoose.Types.ObjectId(req.session.user.id);
    const base = { _id: req.params.id, moderationStatus: "approved" };

    // Alternar o apoio com operações ATÔMICAS no banco. Antes: carregava a
    // sugestão inteira (com todos os votos), alterava o array em memória e
    // salvava — duas pessoas apoiando ao mesmo tempo podiam sobrescrever o voto
    // uma da outra. Agora: primeiro tenta remover o apoio existente; se não
    // havia, adiciona (só se ainda não existir).
    const removed = await Suggestion.updateOne(
      { ...base, "votes.user": userId },
      { $pull: { votes: { user: userId } } }
    );
    if (removed.matchedCount === 0) {
      const now = new Date();
      const added = await Suggestion.updateOne(
        { ...base, "votes.user": { $ne: userId } },
        { $push: { votes: { user: userId, createdAt: now, updatedAt: now } } }
      );
      if (added.matchedCount === 0) return res.status(404).render("404", { title: "Não encontrado" });
    }
    res.redirect("/sugestoes");
  } catch (err) {
    console.error(err);
    res.redirect("/sugestoes");
  }
});

module.exports = router;
