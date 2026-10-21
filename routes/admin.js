const express = require("express");
const router = express.Router();
const { requireAdmin, invalidateUserCache } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const User = require("../models/User");
const Topic = require("../models/Topic");
const Comment = require("../models/Comment");
const Faq = require("../models/Faq");
const FaqCategory = require("../models/FaqCategory");
const Suggestion = require("../models/Suggestion");
const Notification = require("../models/Notification");
const Report = require("../models/Report");
const { CATEGORIES, catLabel, catCls } = require("../models/categories");
const { createNotification } = require("../helpers/notifications");
const { buildSearchRegex } = require("../helpers/search");
const { queryString, paginate } = require("../helpers/query");
const firebase = require("../helpers/firebase");

const PAGE_SIZE = 20;

router.use(requireAdmin);

// ─── DASHBOARD ──────────────────────────────────────────────────────────────
router.get("/", asyncHandler(async (req, res) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    userCount, topicCount, commentCount, faqCount, blockedCount, pendingSuggestionCount, pendingReportCount,
    newUsersThisMonth, newTopicsThisWeek, newCommentsThisWeek, newFaqsThisWeek,
    recentTopics, recentUsers,
  ] = await Promise.all([
    // Totais sem filtro: estimatedDocumentCount lê só os metadados da coleção.
    User.estimatedDocumentCount(),
    Topic.estimatedDocumentCount(),
    Comment.estimatedDocumentCount(),
    Faq.estimatedDocumentCount(),
    User.countDocuments({ status: "bloqueado" }),
    Suggestion.countDocuments({ moderationStatus: "pending" }),
    Report.countDocuments({ status: "pending" }),
    // Deltas exibidos no dashboard: antes eram números fixos no HTML, sem
    // relação com o banco (ver P-02 da auditoria). Agora refletem a
    // atividade real do período.
    User.countDocuments({ createdAt: { $gte: startOfMonth } }),
    Topic.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    Comment.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    Faq.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    // Antes, estas duas consultas esperavam as 11 contagens terminarem.
    Topic.find().sort({ createdAt: -1 }).limit(3).select("title createdAt").lean(),
    // Sem .lean(): a view chama u.roleLabel(), que é um método do model.
    User.find().sort({ createdAt: -1 }).limit(3).select("name role createdAt"),
  ]);

  res.render("admin/dashboard", {
    title: "Painel Administrativo",
    tab: "dashboard",
    stats: {
      userCount, topicCount, commentCount, faqCount, blockedCount, pendingSuggestionCount, pendingReportCount,
      newUsersThisMonth, newTopicsThisWeek, newCommentsThisWeek, newFaqsThisWeek,
    },
    recentTopics,
    recentUsers,
  });
}));

// ─── GERENCIAR FAQ ──────────────────────────────────────────────────────────
router.get("/faq", asyncHandler(async (req, res) => {
  const faqs = await Faq.find().populate("category").sort({ createdAt: -1 });
  res.render("admin/faq", { title: "Gerenciar FAQ", tab: "faq", faqs });
}));

router.get("/faq/novo", asyncHandler(async (req, res) => {
  const categories = await FaqCategory.find();
  res.render("admin/faq-form", { title: "Nova Pergunta", tab: "faq", categories, faq: null, errors: {} });
}));

router.post("/faq/novo", asyncHandler(async (req, res) => {
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
}));

router.get("/faq/:id/editar", asyncHandler(async (req, res) => {
  const faq = await Faq.findById(req.params.id);
  const categories = await FaqCategory.find();
  if (!faq) return res.redirect("/admin/faq");
  res.render("admin/faq-form", { title: "Editar Pergunta", tab: "faq", categories, faq, errors: {} });
}));

router.post("/faq/:id/editar", asyncHandler(async (req, res) => {
  const { question, answer, category } = req.body;

  // findByIdAndUpdate NÃO roda as validações do schema: antes, salvar o
  // formulário com um campo vazio gravava pergunta/resposta em branco (e uma
  // categoria vazia deixava a pergunta "sem categoria"). Agora tem a mesma
  // validação do cadastro de nova pergunta.
  const errors = {};
  if (!question || !question.trim()) errors.question = "Pergunta obrigatória.";
  if (!answer || !answer.trim()) errors.answer = "Resposta obrigatória.";
  if (!category) errors.category = "Selecione uma categoria.";

  if (Object.keys(errors).length > 0) {
    const categories = await FaqCategory.find();
    return res.render("admin/faq-form", {
      title: "Editar Pergunta", tab: "faq", categories,
      faq: { _id: req.params.id, question, answer, category }, errors,
    });
  }

  await Faq.findByIdAndUpdate(req.params.id, { question: question.trim(), answer: answer.trim(), category });
  res.redirect("/admin/faq");
}));

router.post("/faq/:id/excluir", asyncHandler(async (req, res) => {
  await Faq.findByIdAndDelete(req.params.id);
  res.redirect("/admin/faq");
}));

// ─── MODERAR FÓRUM ──────────────────────────────────────────────────────────
router.get("/forum", asyncHandler(async (req, res) => {
  const { items: topics, total, totalPages, page: safePage } = await paginate({
    page: req.query.page,
    pageSize: PAGE_SIZE,
    count: () => Topic.estimatedDocumentCount(),
    find: (skip, limit) => Topic.find().sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select("title category authorName locked createdAt").lean(),
  });

  res.render("admin/forum", {
    title: "Moderar Fórum", tab: "forum", topics, total, catLabel, catCls,
    page: safePage, totalPages, baseQuery: "", basePath: "/admin/forum",
  });
}));

router.post("/forum/:id/toggle-lock", asyncHandler(async (req, res) => {
  const topic = await Topic.findById(req.params.id);
  if (topic) {
    topic.locked = !topic.locked;
    await topic.save();
  }
  res.redirect("/admin/forum");
}));

router.post("/forum/:id/excluir", asyncHandler(async (req, res) => {
  await Promise.all([
    Topic.findByIdAndDelete(req.params.id),
    Comment.deleteMany({ topic: req.params.id }),
    Report.deleteMany({ topic: req.params.id }),
  ]);
  res.redirect("/admin/forum");
}));

// Exclusão de um único comentário — antes, a única opção de moderação era
// excluir o tópico inteiro, o que apagava também as respostas legítimas
// (ver P-30 da auditoria). Volta para o tópico de origem, não para a lista.
router.post("/forum/comentario/:id/excluir", asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  const topicId = comment ? comment.topic : req.body.topicId;
  if (comment) {
    await Comment.findByIdAndDelete(req.params.id);
    await Report.deleteMany({ comment: req.params.id });
  }
  res.redirect(topicId ? `/forum/topico/${topicId}` : "/admin/forum");
}));

// ─── DENÚNCIAS ──────────────────────────────────────────────────────────────
// Fila de moderação para denúncias enviadas pelos usuários (ver P-29).
router.get("/denuncias", asyncHandler(async (req, res) => {
  const filter = queryString(req.query.filter) || "all";
  const query = filter === "all" ? {} : { status: filter };

  const { items: reports, total, totalPages, page: safePage } = await paginate({
    page: req.query.page,
    pageSize: PAGE_SIZE,
    count: () => Report.countDocuments(query),
    // A tela só mostra o título do tópico e o texto do comentário: o populate
    // busca apenas esses campos (antes trazia os documentos inteiros).
    find: (skip, limit) => Report.find(query)
      .populate("topic", "title")
      .populate("comment", "text")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
  });

  res.render("admin/reports", {
    title: "Denúncias", tab: "reports", reports, total, filter,
    page: safePage, totalPages, baseQuery: `filter=${encodeURIComponent(filter)}`, basePath: "/admin/denuncias",
  });
}));

router.post("/denuncias/:id/status", asyncHandler(async (req, res) => {
  const validStatuses = ["reviewed", "dismissed"];
  if (validStatuses.includes(req.body.status)) {
    await Report.findByIdAndUpdate(req.params.id, { status: req.body.status });
  }
  res.redirect("/admin/denuncias");
}));

// ─── MODERAR SUGESTÕES ─────────────────────────────────────────────────────
router.get("/sugestoes", asyncHandler(async (req, res) => {
  const filter = queryString(req.query.filter) || "all";
  const query = filter === "all" ? {} : { moderationStatus: filter };

  // BUG corrigido: antes ordenava por `{ votes: -1 }`, mas `votes` é uma lista de
  // objetos — o MongoDB não ordena por quantidade de itens, então a ordem na
  // prática era aleatória. Agora ordena de verdade por número de apoios (maior
  // primeiro) e, em empate, pelas mais recentes. A lista de votos em si não é
  // trazida: a tela só mostra a quantidade.
  const { items: suggestions, total, totalPages, page: safePage } = await paginate({
    page: req.query.page,
    pageSize: PAGE_SIZE,
    count: () => Suggestion.countDocuments(query),
    find: (skip, limit) => Suggestion.aggregate([
      { $match: query },
      { $addFields: { supportCount: { $size: { $ifNull: ["$votes", []] } } } },
      { $sort: { supportCount: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { votes: 0, description: 0 } },
    ]),
  });

  res.render("admin/suggestions", {
    title: "Moderar Sugestões", tab: "suggestions", suggestions, total, filter,
    page: safePage, totalPages, baseQuery: `filter=${encodeURIComponent(filter)}`, basePath: "/admin/sugestoes",
  });
}));

router.get("/sugestoes/:id", asyncHandler(async (req, res) => {
  const suggestion = await Suggestion.findById(req.params.id);
  if (!suggestion) return res.redirect("/admin/sugestoes");
  res.render("admin/suggestion-detail", { title: "Avaliar sugestão", tab: "suggestions", suggestion, errors: {} });
}));

router.post("/sugestoes/:id/aprovar", asyncHandler(async (req, res) => {
  const suggestion = await Suggestion.findById(req.params.id);
  await Suggestion.findByIdAndUpdate(req.params.id, {
    moderationStatus: "approved", publishedAt: new Date(), rejectionReason: "",
  });
  if (suggestion && !suggestion.isAnonymous) {
    await createNotification(
      suggestion.author,
      "suggestion_approved",
      `Sua sugestão "${suggestion.title}" foi aprovada e já está visível no campus!`,
      `/sugestoes`
    );
  }
  res.redirect("/admin/sugestoes");
}));

router.post("/sugestoes/:id/rejeitar", asyncHandler(async (req, res) => {
  const reason = (req.body.reason || "").trim();
  const suggestion = await Suggestion.findById(req.params.id);
  await Suggestion.findByIdAndUpdate(req.params.id, { moderationStatus: "rejected", rejectionReason: reason });
  if (suggestion && !suggestion.isAnonymous) {
    const reasonText = reason ? ` Motivo: ${reason}` : "";
    await createNotification(
      suggestion.author,
      "suggestion_rejected",
      `Sua sugestão "${suggestion.title}" não foi aprovada.${reasonText}`,
      `/sugestoes`
    );
  }
  res.redirect("/admin/sugestoes");
}));

router.post("/sugestoes/:id/status", asyncHandler(async (req, res) => {
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
  const suggestion = await Suggestion.findById(req.params.id);
  await Suggestion.findByIdAndUpdate(req.params.id, {
    status,
    statusReason: status === "not_implemented" ? statusReason.trim() : "",
  });
  if (suggestion && !suggestion.isAnonymous) {
    const statusLabels = { analysis: "em análise", planned: "planejada", implemented: "implementada", not_implemented: "não implementada" };
    await createNotification(
      suggestion.author,
      "suggestion_status",
      `Sua sugestão "${suggestion.title}" teve o status alterado para "${statusLabels[status]}".`,
      `/sugestoes`
    );
  }
  res.redirect(`/admin/sugestoes/${req.params.id}`);
}));

router.post("/sugestoes/:id/excluir", asyncHandler(async (req, res) => {
  await Suggestion.findByIdAndDelete(req.params.id);
  res.redirect("/admin/sugestoes");
}));

// ─── USUÁRIOS ───────────────────────────────────────────────────────────────
router.get("/users", asyncHandler(async (req, res) => {
  const q = queryString(req.query.q);
  const filter = q
    ? { $or: [{ name: buildSearchRegex(q) }, { email: buildSearchRegex(q) }] }
    : {};

  const { items: users, total, totalPages, page: safePage } = await paginate({
    page: req.query.page,
    pageSize: PAGE_SIZE,
    count: () => User.countDocuments(filter),
    // Nunca traz o hash da senha para esta tela (a view não usa).
    find: (skip, limit) => User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select("name email role isAdmin status createdAt"),
  });

  res.render("admin/users", {
    title: "Usuários", tab: "users", users, total, query: q,
    deleteError: req.query.erro === "firebase",
    page: safePage, totalPages, baseQuery: q ? `q=${encodeURIComponent(q)}` : "", basePath: "/admin/users",
  });
}));

router.post("/users/:id/toggle-status", asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user) {
    user.status = user.status === "ativo" ? "bloqueado" : "ativo";
    await user.save();
    // Aplica o bloqueio/desbloqueio na hora, sem esperar o cache de conta expirar.
    invalidateUserCache(user._id);
  }
  res.redirect("/admin/users");
}));

router.post("/users/:id/role", asyncHandler(async (req, res) => {
  const validRoles = ["estudante", "professor", "staff"];
  if (!validRoles.includes(req.body.role)) return res.redirect("/admin/users");
  const user = await User.findById(req.params.id);
  if (user && !(user._id.toString() === req.session.user.id)) {
    user.role = req.body.role;
    await user.save();
    invalidateUserCache(user._id);
  }
  res.redirect("/admin/users");
}));

router.post("/users/:id/toggle-admin", asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user && !(user.isAdmin && user._id.toString() === req.session.user.id)) {
    // Impede remover o status de admin de alguém se essa pessoa for a única
    // administradora restante do sistema — sem isso, seria possível zerar
    // por completo o acesso administrativo (ver P-13 da auditoria).
    if (user.isAdmin) {
      const adminCount = await User.countDocuments({ isAdmin: true });
      if (adminCount <= 1) {
        return res.redirect("/admin/users");
      }
    }
    user.isAdmin = !user.isAdmin;
    await user.save();
    invalidateUserCache(user._id);
  }
  res.redirect("/admin/users");
}));

router.post("/users/:id/excluir", asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.redirect("/admin/users");

  // Impede excluir a única conta de administrador restante — sem isso, o
  // sistema poderia ficar sem nenhum admin, recuperável só via acesso direto
  // ao banco (ver P-13 da auditoria).
  if (user.isAdmin) {
    const adminCount = await User.countDocuments({ isAdmin: true });
    if (adminCount <= 1) {
      return res.redirect("/admin/users");
    }
  }

  // Conta vinculada ao Firebase: apaga lá PRIMEIRO. Se falhar, a exclusão é
  // interrompida sem mexer em nada no MongoDB — assim nunca sobra conta
  // órfã no Firebase nem usuário pela metade. O admin pode tentar de novo.
  if (user.firebaseUid) {
    try {
      if (!firebase.isAdminConfigured()) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT não está configurada");
      }
      await firebase.deleteUser(user.firebaseUid);
    } catch (err) {
      console.error(`Falha ao excluir ${user.email} no Firebase:`, err.message);
      return res.redirect("/admin/users?erro=firebase");
    }
  }

  const ANONYMOUS_LABEL = "Usuário removido";

  // Conteúdo público (tópicos, comentários, sugestões) é mantido — preserva
  // o histórico do fórum — mas o nome exibido é substituído. O campo
  // `author` continua referenciando o id do usuário excluído; nada no
  // sistema faz populate() dele hoje (só authorName é exibido), então isso
  // não quebra a exibição. Ver P-08 da auditoria para o raciocínio completo.
  await Promise.all([
    Topic.updateMany({ author: user._id }, { authorName: ANONYMOUS_LABEL }),
    Comment.updateMany({ author: user._id }, { authorName: ANONYMOUS_LABEL }),
    Suggestion.updateMany({ author: user._id }, { authorName: ANONYMOUS_LABEL }),
  ]);

  // Dados estritamente privados do usuário não têm razão para sobreviver:
  // notificações só são visíveis para a própria conta (que deixará de
  // existir), e um voto de apoio a sugestões não deve continuar contando
  // permanentemente para alguém que não existe mais no sistema.
  await Promise.all([
    Notification.deleteMany({ recipient: user._id }),
    Suggestion.updateMany({ "votes.user": user._id }, { $pull: { votes: { user: user._id } } }),
  ]);

  // Por fim, remove os dados de identificação/acesso propriamente ditos:
  // nome, e-mail e senha (hash) não sobrevivem à exclusão.
  await User.findByIdAndDelete(user._id);
  invalidateUserCache(user._id);

  res.redirect("/admin/users");
}));

module.exports = router;
