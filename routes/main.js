const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const Topic = require("../models/Topic");
const Comment = require("../models/Comment");
const Faq = require("../models/Faq");
const FaqCategory = require("../models/FaqCategory");
const User = require("../models/User");
const Suggestion = require("../models/Suggestion");
const Report = require("../models/Report");
const FlaggedPost = require("../models/FlaggedPost");
const { CATEGORIES } = require("../models/categories");
const { createNotification } = require("../helpers/notifications");
const { buildSearchRegex } = require("../helpers/search");
const { asString, isObjectIdString, paginate } = require("../helpers/query");
const { authorRoleLabel } = require("../helpers/roles");
const { wantsJson } = require("../helpers/http");
const { moderateFields } = require("../helpers/moderation");
const { deleteTopicCascade, deleteCommentCascade } = require("../helpers/forumCleanup");
const { contentLimiter } = require("../middleware/rateLimit");

const PAGE_SIZE = 20; // tópicos por página no fórum

const TOPIC_TITLE_MAX = 120;
const TOPIC_BODY_MAX = 5000;
const REPLY_MIN = 10;
const REPLY_MAX = 3000;
const SUGGESTION_TITLE_MAX = 120;
const SUGGESTION_DESC_MAX = 3000;

// Mesma regra do virtual `isRecent` do model Topic ("criado nas últimas 48h"),
// para as listagens que usam .lean() (objetos simples, sem virtuals).
const RECENT_MS = 1000 * 60 * 60 * 48;
function isRecent(createdAt) {
  if (!createdAt) return true;
  return Date.now() - new Date(createdAt).getTime() < RECENT_MS;
}

// Conta as respostas de vários tópicos em uma única consulta agregada.
async function getReplyCounts(topicIds) {
  if (topicIds.length === 0) return new Map();
  const rows = await Comment.aggregate([
    { $match: { topic: { $in: topicIds } } },
    { $group: { _id: "$topic", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}

// Campos que as listagens exibem. Deixar de fora `content` (até 5000
// caracteres por tópico) e `tags` reduz o volume lido do banco.
const TOPIC_LIST_FIELDS = "title category authorName locked createdAt views solvedComment";

const notFound = (res) => res.status(404).render("404", { title: "Não encontrado" });

// ─── HOME ───────────────────────────────────────────────────────────────────
router.get("/", asyncHandler(async (req, res) => {
  // As consultas da home são independentes e rodam em paralelo. Os totais usam
  // estimatedDocumentCount (lê só os metadados da coleção). A contagem de
  // respostas dos tópicos recentes depende da lista de tópicos, então é
  // encadeada a ela, mas também em paralelo com o resto.
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
    // A home só mostra o texto da pergunta, sem precisar da categoria.
    Faq.find().sort({ createdAt: 1, _id: 1 }).select("question").limit(4).lean(),
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
  });
}));

// ─── FORUM (lista) ──────────────────────────────────────────────────────────
router.get("/forum", asyncHandler(async (req, res) => {
  // Parâmetros sempre como texto (ver helpers/query.js).
  const q = asString(req.query.q).trim();
  const cat = asString(req.query.cat);
  const sort = asString(req.query.sort);

  const filter = {};
  if (cat) filter.category = cat;
  if (q) filter.title = buildSearchRegex(q);

  // "Populares" desempata por data: só por `views` há muitos empates (todo
  // tópico novo tem 0) e a paginação poderia repetir ou pular tópicos.
  const sortSpec = sort === "popular" ? { views: -1, createdAt: -1 } : { createdAt: -1 };

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
    solved: !!t.solvedComment,
    replyCount: replyCountMap.get(t._id.toString()) || 0,
  }));

  // Query string dos links de paginação, para preservar os filtros ativos.
  const baseQueryParts = [];
  if (cat) baseQueryParts.push(`cat=${encodeURIComponent(cat)}`);
  if (q) baseQueryParts.push(`q=${encodeURIComponent(q)}`);
  if (sort && sort !== "recent") baseQueryParts.push(`sort=${encodeURIComponent(sort)}`);

  res.render("forum", {
    title: "Fórum de Discussões",
    topics,
    categories: CATEGORIES,
    query: q,
    selCat: cat,
    sort: sort || "recent",
    page: safePage,
    totalPages,
    baseQuery: baseQueryParts.join("&"),
    basePath: "/forum",
    removed: req.query.removido === "1",
    analysis: req.query.analise === "1",
  });
}));

// ─── CREATE TOPIC ───────────────────────────────────────────────────────────
router.get("/forum/novo", requireAuth, (req, res) => {
  res.render("create-topic", { title: "Criar Novo Tópico", categories: CATEGORIES, errors: {}, form: {} });
});

router.post("/forum/novo", requireAuth, contentLimiter, asyncHandler(async (req, res) => {
  const title = asString(req.body.title).trim();
  const category = asString(req.body.category);
  const body = asString(req.body.body).trim();
  const form = { title, category, body };
  const errors = {};

  if (!title) errors.title = "Título obrigatório.";
  else if (title.length < 10) errors.title = "O título deve ter ao menos 10 caracteres.";
  else if (title.length > TOPIC_TITLE_MAX) errors.title = `O título pode ter no máximo ${TOPIC_TITLE_MAX} caracteres.`;

  if (!CATEGORIES.some((c) => c.id === category)) errors.category = "Selecione uma categoria.";

  if (body.length < 30) errors.body = "A descrição deve ter ao menos 30 caracteres.";
  else if (body.length > TOPIC_BODY_MAX) errors.body = `A descrição pode ter no máximo ${TOPIC_BODY_MAX} caracteres.`;

  if (Object.keys(errors).length > 0) {
    return res.status(400).render("create-topic", { title: "Criar Novo Tópico", categories: CATEGORIES, errors, form });
  }

  try {
    const moderated = moderateFields({ title, body });
    if (moderated.blocked) {
      await FlaggedPost.create({
        type: "topic",
        author: req.session.user.id,
        authorName: req.session.user.name,
        title: moderated.values.title,
        category,
        content: moderated.values.body,
        blockedTerms: moderated.blockedTerms,
      });
      return res.redirect("/forum?analise=1");
    }

    const topic = await Topic.create({
      title: moderated.values.title,
      category,
      content: moderated.values.body,
      author: req.session.user.id,
      authorName: req.session.user.name,
      tags: [],
    });
    res.redirect(`/forum/topico/${topic._id}?created=1`);
  } catch (err) {
    console.error(err);
    res.status(500).render("create-topic", {
      title: "Criar Novo Tópico",
      categories: CATEGORIES,
      errors: { general: "Não foi possível publicar o tópico. Tente novamente." },
      form,
    });
  }
}));

// ─── TOPIC DETAIL ───────────────────────────────────────────────────────────
const BOT_USER_AGENT = /bot|crawl|spider|slurp|preview|facebookexternalhit/i;
const VIEWED_COOKIE = "tv";
const VIEWED_COOKIE_MAX_IDS = 30;
const VIEWED_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Mostra o cargo ATUAL de cada autor (e não o que estava salvo no momento do
// comentário). Se a conta não existe mais, mantém o cargo salvo.
async function withCurrentRoles(comments) {
  const ids = [...new Set(comments.map((c) => String(c.author)))];
  if (ids.length === 0) return comments;
  const users = await User.find({ _id: { $in: ids } }).select("role isAdmin").lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return comments.map((c) => {
    const u = byId.get(String(c.author));
    return u ? { ...c, authorRole: authorRoleLabel(u) } : c;
  });
}

const TOPIC_NOTICES = {
  submitted: "Sua resposta foi publicada!",
  reported: "Denúncia enviada. A moderação vai revisar.",
  created: "Tópico publicado!",
  removed: "Sua resposta foi excluída.",
  analise: "Sua resposta foi enviada para análise da moderação e será publicada se for aprovada.",
};

// Monta a página do tópico. `comments` pode vir já carregado (rota GET).
async function renderTopicPage(req, res, topic, { comments, replyError = null, replyText = "", actionError = null, status = 200 } = {}) {
  const loaded = comments || (await Comment.find({ topic: topic._id }).sort({ createdAt: 1 }).lean());
  const withRoles = await withCurrentRoles(loaded);
  const noticeKey = Object.keys(TOPIC_NOTICES).find((k) => req.query[k] === "1");
  res.status(status).render("topic-detail", {
    title: topic.title,
    topic,
    comments: withRoles,
    solvedCommentId: topic.solvedComment ? String(topic.solvedComment) : null,
    replyError,
    replyText,
    actionError,
    notice: noticeKey ? TOPIC_NOTICES[noticeKey] : null,
  });
}

router.get("/forum/topico/:id", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return notFound(res);

  // O tópico e os comentários não dependem um do outro: buscados em paralelo.
  const [topic, comments] = await Promise.all([
    Topic.findById(req.params.id).lean(),
    Comment.find({ topic: req.params.id }).sort({ createdAt: 1 }).lean(),
  ]);
  if (!topic) return notFound(res);

  // Conta uma visualização por navegador a cada 12 horas. Não conta o próprio
  // autor nem robôs. A lista de tópicos já vistos fica em um cookie curto.
  const me = req.session.user;
  const isOwner = me && String(topic.author) === String(me.id);
  const seen = asString(req.cookies && req.cookies[VIEWED_COOKIE]).split(",").filter(isObjectIdString);
  const topicId = String(topic._id);
  if (!isOwner && !BOT_USER_AGENT.test(req.get("user-agent") || "") && !seen.includes(topicId)) {
    Topic.updateOne({ _id: topic._id }, { $inc: { views: 1 } }).catch((err) => console.error("Erro ao contar visualização:", err));
    topic.views = (topic.views || 0) + 1;
    res.cookie(VIEWED_COOKIE, [topicId, ...seen].slice(0, VIEWED_COOKIE_MAX_IDS).join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/forum/topico",
      maxAge: VIEWED_COOKIE_MAX_AGE_MS,
    });
  }

  await renderTopicPage(req, res, topic, { comments });
}));

router.post("/forum/topico/:id/responder", requireAuth, contentLimiter, asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return notFound(res);
  const topic = await Topic.findById(req.params.id).lean();
  if (!topic) return notFound(res);

  const rawText = asString(req.body.text);
  const text = rawText.trim();

  if (topic.locked) {
    return renderTopicPage(req, res, topic, { replyError: "Este tópico foi encerrado e não aceita novas respostas.", replyText: rawText, status: 403 });
  }
  if (text.length < REPLY_MIN) {
    return renderTopicPage(req, res, topic, { replyError: `A resposta deve ter ao menos ${REPLY_MIN} caracteres.`, replyText: rawText, status: 400 });
  }
  if (text.length > REPLY_MAX) {
    return renderTopicPage(req, res, topic, { replyError: `A resposta pode ter no máximo ${REPLY_MAX} caracteres.`, replyText: rawText, status: 400 });
  }

  const moderated = moderateFields({ text });
  if (moderated.blocked) {
    await FlaggedPost.create({
      type: "comment",
      author: req.session.user.id,
      authorName: req.session.user.name,
      authorRole: authorRoleLabel(req.session.user),
      topic: topic._id,
      content: moderated.values.text,
      blockedTerms: moderated.blockedTerms,
    });
    return res.redirect(`/forum/topico/${topic._id}?analise=1`);
  }

  const comment = await Comment.create({
    topic: topic._id,
    author: req.session.user.id,
    authorName: req.session.user.name,
    authorRole: authorRoleLabel(req.session.user),
    text: moderated.values.text,
  });

  if (String(topic.author) !== String(req.session.user.id)) {
    // Sem await: createNotification trata os próprios erros e quem respondeu
    // não depende dela para ver a página.
    createNotification(
      topic.author,
      "forum_reply",
      `${req.session.user.name} respondeu ao seu tópico "${topic.title}"`,
      `/forum/topico/${topic._id}`
    );
  }

  res.redirect(`/forum/topico/${topic._id}?submitted=1#comentario-${comment._id}`);
}));

// ─── Resposta que resolveu a dúvida ─────────────────────────────────────────
// O autor do tópico (ou a moderação) marca uma resposta como solução; marcar de
// novo a mesma resposta desfaz a marcação.
router.post("/forum/topico/:id/solucao", requireAuth, asyncHandler(async (req, res) => {
  const commentId = asString(req.body.commentId);
  if (!isObjectIdString(req.params.id) || !isObjectIdString(commentId)) return notFound(res);

  const topic = await Topic.findById(req.params.id);
  if (!topic) return notFound(res);

  const me = req.session.user;
  const canMark = String(topic.author) === String(me.id) || me.isAdmin;
  if (!canMark) return res.status(403).render("403", { title: "Acesso negado" });

  const comment = await Comment.findOne({ _id: commentId, topic: topic._id }).lean();
  if (!comment) return notFound(res);

  if (topic.solvedComment && String(topic.solvedComment) === commentId) {
    topic.solvedComment = null;
  } else {
    topic.solvedComment = comment._id;
    if (String(comment.author) !== String(me.id)) {
      createNotification(
        comment.author,
        "forum_solution",
        `Sua resposta no tópico "${topic.title}" foi marcada como solução`,
        `/forum/topico/${topic._id}`
      );
    }
  }
  await topic.save();
  res.redirect(`/forum/topico/${topic._id}#comentario-${commentId}`);
}));

// ─── Excluir o próprio conteúdo ─────────────────────────────────────────────
router.post("/forum/comentario/:id/excluir", requireAuth, asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return notFound(res);
  const comment = await Comment.findById(req.params.id).lean();
  if (!comment) return notFound(res);
  if (String(comment.author) !== String(req.session.user.id)) {
    return res.status(403).render("403", { title: "Acesso negado" });
  }

  await deleteCommentCascade(comment);
  res.redirect(`/forum/topico/${comment.topic}?removed=1`);
}));

// O autor só pode excluir o tópico enquanto ninguém mais respondeu; depois
// disso, a remoção passa pela moderação para não apagar a conversa dos outros.
router.post("/forum/topico/:id/excluir", requireAuth, asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return notFound(res);
  const topic = await Topic.findById(req.params.id).lean();
  if (!topic) return notFound(res);
  if (String(topic.author) !== String(req.session.user.id)) {
    return res.status(403).render("403", { title: "Acesso negado" });
  }

  const repliesFromOthers = await Comment.countDocuments({ topic: topic._id, author: { $ne: topic.author } });
  if (repliesFromOthers > 0) {
    return renderTopicPage(req, res, topic, {
      actionError: "Este tópico já recebeu respostas de outras pessoas. Para removê-lo, use “Denunciar” ou procure a moderação.",
      status: 409,
    });
  }

  await deleteTopicCascade(topic._id);
  res.redirect("/forum?removido=1");
}));

// ─── DENÚNCIAS (fórum) ──────────────────────────────────────────────────────
// Permite a qualquer usuário autenticado sinalizar um tópico ou um comentário
// específico para revisão da moderação.
const REPORT_REASONS = ["spam", "offensive", "personal_info", "off_topic", "other"];

router.post("/forum/topico/:id/denunciar", requireAuth, contentLimiter, asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return notFound(res);
  const topic = await Topic.findById(req.params.id).lean();
  if (!topic) return notFound(res);

  const reason = asString(req.body.reason);
  const details = asString(req.body.details);
  const commentId = asString(req.body.commentId);
  const back = `/forum/topico/${topic._id}`;

  if (!REPORT_REASONS.includes(reason)) return res.redirect(back);

  let comment = null;
  if (commentId) {
    if (!isObjectIdString(commentId)) return res.redirect(back);
    comment = await Comment.findOne({ _id: commentId, topic: topic._id }).lean();
    if (!comment) return res.redirect(back);
  }

  // A mesma pessoa não precisa denunciar duas vezes o mesmo conteúdo: ele já
  // está na fila da moderação desde a primeira denúncia.
  const alreadyReported = await Report.findOne({
    reporter: req.session.user.id,
    topic: topic._id,
    comment: comment ? comment._id : null,
  }).lean();
  if (!alreadyReported) {
    await Report.create({
      targetType: comment ? "comment" : "topic",
      topic: topic._id,
      comment: comment ? comment._id : null,
      reporter: req.session.user.id,
      reason,
      details: details.trim().slice(0, 500),
    });
  }

  res.redirect(`${back}?reported=1${comment ? `#comentario-${comment._id}` : ""}`);
}));

// ─── FAQ ────────────────────────────────────────────────────────────────────
router.get("/faq", asyncHandler(async (req, res) => {
  const q = asString(req.query.q).trim();
  // Um id de categoria inválido (ex.: /faq?cat=abc) é simplesmente ignorado.
  const cat = isObjectIdString(req.query.cat) ? req.query.cat : "";

  const filter = {};
  if (cat) filter.category = cat;
  if (q) {
    filter.$or = [{ question: buildSearchRegex(q) }, { answer: buildSearchRegex(q) }];
  }

  // As três consultas são independentes e rodam em paralelo. A contagem por
  // categoria é feita pelo próprio banco (agregação).
  const [categories, faqRows, countRows] = await Promise.all([
    FaqCategory.find().lean(),
    Faq.find(filter).sort({ createdAt: 1, _id: 1 }).select("question answer details").lean(),
    Faq.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]),
  ]);

  // A lista só precisa saber se existe página própria, não do texto longo.
  const faqs = faqRows.map(({ details, ...faq }) => ({ ...faq, hasDetails: !!details }));

  const counts = {};
  countRows.forEach((row) => {
    if (row._id) counts[row._id.toString()] = row.n;
  });

  res.render("faq", { title: "FAQ", faqs, categories, counts, query: q, selCat: cat });
}));

// Página própria de uma pergunta com resposta completa. Perguntas sem texto
// longo continuam só no acordeão da lista.
router.get("/faq/:id", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return notFound(res);
  const faq = await Faq.findById(req.params.id).populate("category", "name").lean();
  if (!faq) return notFound(res);
  if (!faq.details) return res.redirect(`/faq#faq-${faq._id}`);

  res.render("faq-detail", { title: faq.question, faq });
}));

// ─── SUGESTÕES PARA O CAMPUS ───────────────────────────────────────────────
router.get("/sugestoes", asyncHandler(async (req, res) => {
  const currentUserId = req.session.user ? String(req.session.user.id) : null;
  const userObjectId = isObjectIdString(currentUserId) ? new mongoose.Types.ObjectId(currentUserId) : null;

  // O total de apoios e "este usuário já apoiou?" são calculados pelo banco, em
  // vez de trazer a lista completa de votos de cada sugestão.
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
}));

router.get("/sugestoes/nova", requireAuth, (req, res) => {
  res.render("create-suggestion", { title: "Enviar sugestão", errors: {}, form: {} });
});

router.post("/sugestoes/nova", requireAuth, contentLimiter, asyncHandler(async (req, res) => {
  const title = asString(req.body.title).trim();
  const description = asString(req.body.description).trim();
  const identity = asString(req.body.identity);
  const form = { title, description, identity };
  const errors = {};

  if (!title) errors.title = "Título obrigatório.";
  else if (title.length < 10) errors.title = "O título deve ter ao menos 10 caracteres.";
  else if (title.length > SUGGESTION_TITLE_MAX) errors.title = `O título pode ter no máximo ${SUGGESTION_TITLE_MAX} caracteres.`;

  if (!description) errors.description = "Descrição obrigatória.";
  else if (description.length < 30) errors.description = "A descrição deve ter ao menos 30 caracteres.";
  else if (description.length > SUGGESTION_DESC_MAX) errors.description = `A descrição pode ter no máximo ${SUGGESTION_DESC_MAX} caracteres.`;

  if (identity !== "named" && identity !== "anonymous") errors.identity = "Selecione como deseja publicar.";

  if (Object.keys(errors).length) {
    return res.status(400).render("create-suggestion", { title: "Enviar sugestão", errors, form });
  }

  try {
    // Toda sugestão já espera a aprovação da administração; quando há termo
    // proibido, os termos encontrados ficam registrados para o administrador.
    const moderated = moderateFields({ title, description });
    await Suggestion.create({
      title: moderated.values.title,
      description: moderated.values.description,
      author: req.session.user.id,
      authorName: req.session.user.name,
      isAnonymous: identity === "anonymous",
      flaggedTerms: moderated.blockedTerms,
    });
    res.redirect("/sugestoes?enviada=1");
  } catch (err) {
    console.error(err);
    res.status(500).render("create-suggestion", {
      title: "Enviar sugestão",
      errors: { general: "Não foi possível enviar sua sugestão. Tente novamente." },
      form,
    });
  }
}));

// Apoia ou remove o apoio. Responde JSON para a chamada fetch do site (o botão
// é atualizado sem recarregar a página) e redireciona nos envios normais de
// formulário, que continuam funcionando sem JavaScript.
router.post("/sugestoes/:id/apoio", requireAuth, asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return notFound(res);

  const id = new mongoose.Types.ObjectId(req.params.id);
  const userId = new mongoose.Types.ObjectId(req.session.user.id);
  const base = { _id: id, moderationStatus: "approved" };

  // O apoio é alternado com operações atômicas no banco: primeiro tenta remover
  // o apoio existente; se não havia, adiciona (só se ainda não existir). Assim,
  // dois apoios simultâneos não sobrescrevem um ao outro.
  let supported = false;
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
    if (added.matchedCount === 0) {
      if (wantsJson(req)) return res.status(404).json({ error: "Sugestão não encontrada." });
      return notFound(res);
    }
    supported = true;
  }

  if (wantsJson(req)) {
    const [row] = await Suggestion.aggregate([
      { $match: { _id: id } },
      { $project: { count: { $size: { $ifNull: ["$votes", []] } } } },
    ]);
    return res.json({ supported, count: row ? row.count : 0 });
  }
  res.redirect(`/sugestoes#sug-${id}`);
}));

module.exports = router;
