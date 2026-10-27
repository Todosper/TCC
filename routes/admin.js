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
const { createNotification } = require("../helpers/notifications");
const { buildSearchRegex } = require("../helpers/search");
const { asString, isObjectIdString, paginate } = require("../helpers/query");
const { deleteTopicCascade, deleteCommentCascade } = require("../helpers/forumCleanup");
const firebase = require("../helpers/firebase");

const PAGE_SIZE = 20;

// Cores e ícones disponíveis para as categorias do FAQ (devem existir no CSS e
// no mapa de ícones de views/faq.ejs).
const FAQ_CATEGORY_COLORS = [
  { cls: "faqcat-emerald", label: "Verde" },
  { cls: "faqcat-blue", label: "Azul" },
  { cls: "faqcat-purple", label: "Roxo" },
  { cls: "faqcat-amber", label: "Amarelo" },
  { cls: "faqcat-orange", label: "Laranja" },
  { cls: "faqcat-red", label: "Vermelho" },
];
const FAQ_CATEGORY_ICONS = [
  { icon: "HelpCircle", label: "Interrogação" },
  { icon: "FileText", label: "Documento" },
  { icon: "BookOpen", label: "Livro" },
  { icon: "Award", label: "Prêmio" },
  { icon: "Monitor", label: "Computador" },
  { icon: "Users", label: "Pessoas" },
  { icon: "Briefcase", label: "Maleta" },
];

const notFoundAdmin = (res) => res.status(404).render("404", { title: "Não encontrado" });

router.use(requireAdmin);

// ─── DASHBOARD ──────────────────────────────────────────────────────────────
router.get("/", asyncHandler(async (req, res) => {
  // Início do mês no horário de Brasília (UTC-3), e não no fuso do servidor.
  const brasiliaNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const startOfMonth = new Date(Date.UTC(brasiliaNow.getUTCFullYear(), brasiliaNow.getUTCMonth(), 1, 3, 0, 0));
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
    // Variações do período exibidas nos cartões do painel.
    User.countDocuments({ createdAt: { $gte: startOfMonth } }),
    Topic.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    Comment.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    Faq.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
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

// Valida os campos do formulário de pergunta. Devolve { values, errors }.
async function validateFaqForm(body) {
  const question = asString(body.question).trim();
  const answer = asString(body.answer).trim();
  const category = asString(body.category);
  const errors = {};
  if (!question) errors.question = "Pergunta obrigatória.";
  if (!answer) errors.answer = "Resposta obrigatória.";
  if (!isObjectIdString(category) || !(await FaqCategory.exists({ _id: category }))) {
    errors.category = "Selecione uma categoria.";
  }
  return { values: { question, answer, category }, errors };
}

router.get("/faq/novo", asyncHandler(async (req, res) => {
  const categories = await FaqCategory.find();
  res.render("admin/faq-form", { title: "Nova Pergunta", tab: "faq", categories, faq: null, errors: {} });
}));

router.post("/faq/novo", asyncHandler(async (req, res) => {
  const { values, errors } = await validateFaqForm(req.body);
  if (Object.keys(errors).length > 0) {
    const categories = await FaqCategory.find();
    return res.status(400).render("admin/faq-form", { title: "Nova Pergunta", tab: "faq", categories, faq: values, errors });
  }
  await Faq.create(values);
  res.redirect("/admin/faq");
}));

router.get("/faq/:id/editar", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/faq");
  const [faq, categories] = await Promise.all([Faq.findById(req.params.id), FaqCategory.find()]);
  if (!faq) return res.redirect("/admin/faq");
  res.render("admin/faq-form", { title: "Editar Pergunta", tab: "faq", categories, faq, errors: {} });
}));

router.post("/faq/:id/editar", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/faq");

  // findByIdAndUpdate não roda as validações do schema, então elas são feitas
  // aqui, com a mesma regra do cadastro de nova pergunta.
  const { values, errors } = await validateFaqForm(req.body);
  if (Object.keys(errors).length > 0) {
    const categories = await FaqCategory.find();
    return res.status(400).render("admin/faq-form", {
      title: "Editar Pergunta", tab: "faq", categories,
      faq: { _id: req.params.id, ...values }, errors,
    });
  }

  await Faq.findByIdAndUpdate(req.params.id, values);
  res.redirect("/admin/faq");
}));

router.post("/faq/:id/excluir", asyncHandler(async (req, res) => {
  if (isObjectIdString(req.params.id)) await Faq.findByIdAndDelete(req.params.id);
  res.redirect("/admin/faq");
}));

// ─── CATEGORIAS DO FAQ ──────────────────────────────────────────────────────
async function renderFaqCategories(res, { errors = {}, form = {}, status = 200, notice = null } = {}) {
  const [categories, countRows] = await Promise.all([
    FaqCategory.find().sort({ name: 1 }).lean(),
    Faq.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]),
  ]);
  const counts = {};
  countRows.forEach((row) => {
    if (row._id) counts[row._id.toString()] = row.n;
  });
  res.status(status).render("admin/faq-categories", {
    title: "Categorias do FAQ", tab: "faq", categories, counts, errors, form, notice,
    colors: FAQ_CATEGORY_COLORS, icons: FAQ_CATEGORY_ICONS,
  });
}

router.get("/faq-categorias", asyncHandler(async (req, res) => {
  const notice = { created: "Categoria criada.", deleted: "Categoria excluída." }[asString(req.query.ok)] || null;
  await renderFaqCategories(res, { notice });
}));

router.post("/faq-categorias", asyncHandler(async (req, res) => {
  const name = asString(req.body.name).trim();
  const cls = asString(req.body.cls);
  const icon = asString(req.body.icon);
  const form = { name, cls, icon };
  const errors = {};

  if (name.length < 2) errors.name = "Informe o nome da categoria.";
  else if (name.length > 60) errors.name = "O nome pode ter no máximo 60 caracteres.";
  else if (await FaqCategory.exists({ name })) errors.name = "Já existe uma categoria com esse nome.";
  if (!FAQ_CATEGORY_COLORS.some((c) => c.cls === cls)) errors.cls = "Escolha uma cor.";
  if (!FAQ_CATEGORY_ICONS.some((i) => i.icon === icon)) errors.icon = "Escolha um ícone.";

  if (Object.keys(errors).length > 0) return renderFaqCategories(res, { errors, form, status: 400 });

  await FaqCategory.create({ name, cls, icon });
  res.redirect("/admin/faq-categorias?ok=created");
}));

// Só categorias sem perguntas podem ser excluídas, para nunca deixar uma
// pergunta sem categoria.
router.post("/faq-categorias/:id/excluir", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/faq-categorias");
  if (await Faq.exists({ category: req.params.id })) {
    return renderFaqCategories(res, {
      errors: { general: "Essa categoria ainda tem perguntas. Mova ou exclua as perguntas antes de removê-la." },
      status: 409,
    });
  }
  await FaqCategory.findByIdAndDelete(req.params.id);
  res.redirect("/admin/faq-categorias?ok=deleted");
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
    title: "Moderar Fórum", tab: "forum", topics, total,
    page: safePage, totalPages, baseQuery: "", basePath: "/admin/forum",
  });
}));

router.post("/forum/:id/toggle-lock", asyncHandler(async (req, res) => {
  if (isObjectIdString(req.params.id)) {
    const topic = await Topic.findById(req.params.id);
    if (topic) {
      topic.locked = !topic.locked;
      await topic.save();
    }
  }
  res.redirect("/admin/forum");
}));

router.post("/forum/:id/excluir", asyncHandler(async (req, res) => {
  if (isObjectIdString(req.params.id)) await deleteTopicCascade(req.params.id);
  res.redirect("/admin/forum");
}));

// Exclusão de um único comentário, sem apagar o tópico inteiro. Volta para o
// tópico de origem.
router.post("/forum/comentario/:id/excluir", asyncHandler(async (req, res) => {
  const topicIdFromForm = asString(req.body.topicId);
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/forum");
  const comment = await Comment.findById(req.params.id).lean();
  if (comment) await deleteCommentCascade(comment);
  const topicId = comment ? comment.topic : topicIdFromForm;
  res.redirect(isObjectIdString(String(topicId)) ? `/forum/topico/${topicId}` : "/admin/forum");
}));

// ─── DENÚNCIAS ──────────────────────────────────────────────────────────────
// Fila de moderação das denúncias enviadas pelos usuários.
const REPORT_FILTERS = ["all", "pending", "reviewed", "dismissed"];

router.get("/denuncias", asyncHandler(async (req, res) => {
  const requested = asString(req.query.filter);
  const filter = REPORT_FILTERS.includes(requested) ? requested : "pending";
  const query = filter === "all" ? {} : { status: filter };

  const { items: reports, total, totalPages, page: safePage } = await paginate({
    page: req.query.page,
    pageSize: PAGE_SIZE,
    count: () => Report.countDocuments(query),
    // A tela mostra o título do tópico e o texto do comentário: o populate
    // busca só esses campos. Pendentes primeiro, as mais antigas na frente.
    find: (skip, limit) => Report.find(query)
      .populate("topic", "title")
      .populate("comment", "text")
      .sort(filter === "pending" ? { createdAt: 1 } : { createdAt: -1 })
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
  const status = asString(req.body.status);
  if (isObjectIdString(req.params.id) && validStatuses.includes(status)) {
    await Report.findByIdAndUpdate(req.params.id, { status });
  }
  res.redirect("/admin/denuncias");
}));

// Exclui o conteúdo denunciado (a resposta, ou o tópico inteiro quando a
// denúncia é sobre o tópico). As denúncias sobre ele saem da fila junto.
router.post("/denuncias/:id/excluir-conteudo", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/denuncias");
  const report = await Report.findById(req.params.id).lean();
  if (report) {
    if (report.targetType === "comment" && report.comment) {
      const comment = await Comment.findById(report.comment).lean();
      if (comment) await deleteCommentCascade(comment);
      else await Report.deleteMany({ comment: report.comment });
    } else {
      await deleteTopicCascade(report.topic);
    }
  }
  res.redirect("/admin/denuncias");
}));

// ─── MODERAR SUGESTÕES ─────────────────────────────────────────────────────
const SUGGESTION_FILTERS = ["all", "pending", "approved", "rejected"];

router.get("/sugestoes", asyncHandler(async (req, res) => {
  const requested = asString(req.query.filter);
  const filter = SUGGESTION_FILTERS.includes(requested) ? requested : "pending";
  const query = filter === "all" ? {} : { moderationStatus: filter };

  // Pendentes: as mais antigas primeiro (ordem de chegada). Demais: as mais
  // apoiadas primeiro e, em empate, as mais recentes. A lista de votos não é
  // trazida, a tela só mostra a quantidade.
  const sortSpec = filter === "pending" ? { createdAt: 1 } : { supportCount: -1, createdAt: -1 };

  const { items: suggestions, total, totalPages, page: safePage } = await paginate({
    page: req.query.page,
    pageSize: PAGE_SIZE,
    count: () => Suggestion.countDocuments(query),
    find: (skip, limit) => Suggestion.aggregate([
      { $match: query },
      { $addFields: { supportCount: { $size: { $ifNull: ["$votes", []] } } } },
      { $sort: sortSpec },
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
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/sugestoes");
  const suggestion = await Suggestion.findById(req.params.id);
  if (!suggestion) return res.redirect("/admin/sugestoes");
  res.render("admin/suggestion-detail", { title: "Avaliar sugestão", tab: "suggestions", suggestion, errors: {} });
}));

// O autor é avisado mesmo quando a sugestão é anônima: o anonimato vale para a
// exibição pública, e a notificação só é vista por ele.
router.post("/sugestoes/:id/aprovar", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/sugestoes");
  const suggestion = await Suggestion.findById(req.params.id);
  await Suggestion.findByIdAndUpdate(req.params.id, {
    moderationStatus: "approved", publishedAt: new Date(), rejectionReason: "",
  });
  if (suggestion) {
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
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/sugestoes");
  const reason = asString(req.body.reason).trim();
  const suggestion = await Suggestion.findById(req.params.id);
  await Suggestion.findByIdAndUpdate(req.params.id, { moderationStatus: "rejected", rejectionReason: reason });
  if (suggestion) {
    const reasonText = reason ? ` Motivo: ${reason}` : "";
    await createNotification(
      suggestion.author,
      "suggestion_rejected",
      `Sua sugestão "${suggestion.title}" não foi aprovada.${reasonText}`,
      `/profile?tab=activity`
    );
  }
  res.redirect("/admin/sugestoes");
}));

router.post("/sugestoes/:id/status", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/sugestoes");
  const status = asString(req.body.status);
  const statusReason = asString(req.body.statusReason).trim();
  const validStatuses = ["analysis", "planned", "implemented", "not_implemented"];
  if (!validStatuses.includes(status)) return res.redirect(`/admin/sugestoes/${req.params.id}`);

  const suggestion = await Suggestion.findById(req.params.id);
  if (!suggestion) return res.redirect("/admin/sugestoes");

  if (status === "not_implemented" && !statusReason) {
    return res.status(400).render("admin/suggestion-detail", {
      title: "Avaliar sugestão", tab: "suggestions", suggestion,
      errors: { statusReason: "Informe uma justificativa para este status." },
    });
  }

  await Suggestion.findByIdAndUpdate(req.params.id, {
    status,
    statusReason: status === "not_implemented" ? statusReason : "",
  });
  const statusLabels = { analysis: "em análise", planned: "planejada", implemented: "implementada", not_implemented: "não implementada" };
  await createNotification(
    suggestion.author,
    "suggestion_status",
    `Sua sugestão "${suggestion.title}" teve o status alterado para "${statusLabels[status]}".`,
    `/sugestoes`
  );
  res.redirect(`/admin/sugestoes/${req.params.id}`);
}));

router.post("/sugestoes/:id/excluir", asyncHandler(async (req, res) => {
  if (isObjectIdString(req.params.id)) await Suggestion.findByIdAndDelete(req.params.id);
  res.redirect("/admin/sugestoes");
}));

// ─── USUÁRIOS ───────────────────────────────────────────────────────────────
const isSelf = (req, user) => String(user._id) === String(req.session.user.id);

router.get("/users", asyncHandler(async (req, res) => {
  const q = asString(req.query.q).trim();
  const filter = q
    ? { $or: [{ name: buildSearchRegex(q) }, { email: buildSearchRegex(q) }] }
    : {};

  const { items: users, total, totalPages, page: safePage } = await paginate({
    page: req.query.page,
    pageSize: PAGE_SIZE,
    count: () => User.countDocuments(filter),
    // Nunca traz o hash da senha para esta tela.
    find: (skip, limit) => User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select("name email role isAdmin status createdAt"),
  });

  const messages = {
    firebase: "Não foi possível excluir a conta no Firebase. Nada foi alterado; tente novamente.",
    self: "Você não pode bloquear nem excluir a própria conta.",
    admin: "Contas de administrador não podem ser bloqueadas. Remova o acesso de administrador antes.",
    lastadmin: "Não é possível remover o último administrador do sistema.",
  };

  res.render("admin/users", {
    title: "Usuários", tab: "users", users, total, query: q,
    notice: messages[asString(req.query.erro)] || null,
    page: safePage, totalPages, baseQuery: q ? `q=${encodeURIComponent(q)}` : "", basePath: "/admin/users",
  });
}));

router.post("/users/:id/toggle-status", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/users");
  const user = await User.findById(req.params.id);
  if (user) {
    // Bloquear a si mesmo ou a outro administrador poderia deixar o painel sem
    // ninguém com acesso. Desbloquear é sempre permitido.
    if (user.status === "ativo") {
      if (isSelf(req, user)) return res.redirect("/admin/users?erro=self");
      if (user.isAdmin) return res.redirect("/admin/users?erro=admin");
    }
    user.status = user.status === "ativo" ? "bloqueado" : "ativo";
    await user.save();
    // Aplica o bloqueio/desbloqueio na hora, sem esperar o cache de conta expirar.
    invalidateUserCache(user._id);
  }
  res.redirect("/admin/users");
}));

router.post("/users/:id/role", asyncHandler(async (req, res) => {
  const validRoles = ["estudante", "professor", "staff"];
  const role = asString(req.body.role);
  if (!isObjectIdString(req.params.id) || !validRoles.includes(role)) return res.redirect("/admin/users");
  const user = await User.findById(req.params.id);
  if (user && !isSelf(req, user)) {
    user.role = role;
    await user.save();
    invalidateUserCache(user._id);
  }
  res.redirect("/admin/users");
}));

router.post("/users/:id/toggle-admin", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/users");
  const user = await User.findById(req.params.id);
  if (user && !(user.isAdmin && isSelf(req, user))) {
    // Não remove o acesso de quem for o único administrador restante: sem
    // isso, seria possível zerar o acesso administrativo do sistema.
    if (user.isAdmin) {
      const adminCount = await User.countDocuments({ isAdmin: true });
      if (adminCount <= 1) return res.redirect("/admin/users?erro=lastadmin");
    }
    user.isAdmin = !user.isAdmin;
    await user.save();
    invalidateUserCache(user._id);
  }
  res.redirect("/admin/users");
}));

router.post("/users/:id/excluir", asyncHandler(async (req, res) => {
  if (!isObjectIdString(req.params.id)) return res.redirect("/admin/users");
  const user = await User.findById(req.params.id);
  if (!user) return res.redirect("/admin/users");

  if (isSelf(req, user)) return res.redirect("/admin/users?erro=self");

  // Não exclui a única conta de administrador restante.
  if (user.isAdmin) {
    const adminCount = await User.countDocuments({ isAdmin: true });
    if (adminCount <= 1) return res.redirect("/admin/users?erro=lastadmin");
  }

  // Conta vinculada ao Firebase: apaga lá primeiro. Se falhar, a exclusão é
  // interrompida sem mexer em nada no MongoDB, para nunca sobrar conta órfã no
  // Firebase nem usuário pela metade. O admin pode tentar de novo.
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

  // O conteúdo público (tópicos, comentários, sugestões) é mantido para
  // preservar o histórico do fórum, mas o nome exibido é substituído. O campo
  // `author` continua apontando para o id do usuário excluído; as telas só
  // exibem `authorName`, então isso não afeta a exibição.
  await Promise.all([
    Topic.updateMany({ author: user._id }, { authorName: ANONYMOUS_LABEL }),
    Comment.updateMany({ author: user._id }, { authorName: ANONYMOUS_LABEL }),
    Suggestion.updateMany({ author: user._id }, { authorName: ANONYMOUS_LABEL }),
  ]);

  // Dados estritamente privados não têm razão para sobreviver: notificações só
  // são vistas pela própria conta, e o apoio a sugestões não deve continuar
  // contando para quem não existe mais.
  await Promise.all([
    Notification.deleteMany({ recipient: user._id }),
    Suggestion.updateMany({ "votes.user": user._id }, { $pull: { votes: { user: user._id } } }),
  ]);

  // Por fim, remove os dados de identificação e acesso: nome, e-mail e senha.
  await User.findByIdAndDelete(user._id);
  invalidateUserCache(user._id);

  res.redirect("/admin/users");
}));

module.exports = router;
