const express = require("express");
const router = express.Router();
const { requireAuth, invalidateUserCache } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const User = require("../models/User");
const Topic = require("../models/Topic");
const Comment = require("../models/Comment");
const Suggestion = require("../models/Suggestion");
const firebase = require("../helpers/firebase");
const { asString } = require("../helpers/query");
const {
  normalizeEmail,
  isValidEmailFormat,
  isAllowedEmailDomain,
  EMAIL_DOMAIN_MESSAGE,
} = require("../helpers/email");

const NAME_MIN = 2;
const NAME_MAX = 100;
const PASSWORD_MIN = 8;
// O bcrypt só considera os primeiros 72 bytes da senha.
const PASSWORD_MAX_BYTES = 72;
const ACTIVITY_LIMIT = 20;

const TABS = ["info", "pw", "activity"];

// Tópicos e sugestões do próprio usuário (aba "Minha atividade").
async function loadActivity(userId) {
  const [topics, suggestions] = await Promise.all([
    Topic.find({ author: userId })
      .sort({ createdAt: -1 })
      .limit(ACTIVITY_LIMIT)
      .select("title category createdAt locked solvedComment")
      .lean(),
    Suggestion.find({ author: userId })
      .sort({ createdAt: -1 })
      .limit(ACTIVITY_LIMIT)
      .select("title moderationStatus status statusReason rejectionReason isAnonymous createdAt")
      .lean(),
  ]);

  const counts = new Map();
  if (topics.length > 0) {
    const rows = await Comment.aggregate([
      { $match: { topic: { $in: topics.map((t) => t._id) } } },
      { $group: { _id: "$topic", count: { $sum: 1 } } },
    ]);
    rows.forEach((r) => counts.set(r._id.toString(), r.count));
  }
  return {
    topics: topics.map((t) => ({ ...t, replyCount: counts.get(t._id.toString()) || 0, solved: !!t.solvedComment })),
    suggestions,
  };
}

async function renderProfile(res, user, { tab = "info", errors = {}, form = null, saved = false, pwSaved = false, status = 200 } = {}) {
  const activity = tab === "activity" ? await loadActivity(user._id) : { topics: [], suggestions: [] };
  res.status(status).render("profile", {
    title: "Meu Perfil",
    user,
    tab,
    saved,
    pwSaved,
    errors,
    form: form || { name: user.name, email: user.email },
    activity,
  });
}

router.get("/profile", requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.user.id).select("-password");
  if (!user) return res.redirect("/login");
  const tab = TABS.includes(req.query.tab) ? req.query.tab : "info";
  await renderProfile(res, user, { tab, saved: req.query.saved === "1", pwSaved: req.query.pwSaved === "1" });
}));

router.post("/profile/info", requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.user.id);
  if (!user) return res.redirect("/login");

  const name = asString(req.body.name).trim();
  const form = { name, email: user.email };
  const errors = {};

  if (name.length < NAME_MIN) errors.name = "Informe seu nome completo.";
  else if (name.length > NAME_MAX) errors.name = `O nome deve ter no máximo ${NAME_MAX} caracteres.`;

  // Em contas vinculadas ao Firebase, o e-mail é a identidade verificada e não
  // pode ser trocado por aqui (senão pularia a verificação). Em contas antigas
  // ele pode mudar; a regra de domínio só vale quando o e-mail é alterado, para
  // não bloquear quem apenas atualiza o nome.
  let newEmail = user.email;
  if (!user.firebaseUid) {
    newEmail = normalizeEmail(req.body.email);
    form.email = newEmail || asString(req.body.email);
    if (newEmail !== user.email) {
      if (!isValidEmailFormat(newEmail)) errors.email = "E-mail inválido.";
      else if (!isAllowedEmailDomain(newEmail)) errors.email = EMAIL_DOMAIN_MESSAGE;
      else if (await User.exists({ email: newEmail, _id: { $ne: user._id } })) errors.email = "Este e-mail já está em uso.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return renderProfile(res, user, { tab: "info", errors, form, status: 400 });
  }

  const nameChanged = name !== user.name;
  user.name = name;
  user.email = newEmail;
  try {
    await user.save();
  } catch (err) {
    if (err && err.code === 11000) {
      return renderProfile(res, user, { tab: "info", errors: { email: "Este e-mail já está em uso." }, form, status: 400 });
    }
    throw err;
  }

  // O nome é copiado para tópicos, comentários e sugestões no momento em que
  // são criados; ao trocá-lo, as cópias antigas são atualizadas.
  if (nameChanged) {
    await Promise.all([
      Topic.updateMany({ author: user._id }, { $set: { authorName: name } }),
      Comment.updateMany({ author: user._id }, { $set: { authorName: name } }),
      Suggestion.updateMany({ author: user._id }, { $set: { authorName: name } }),
    ]);
  }

  req.session.user.name = user.name;
  req.session.user.email = user.email;

  res.redirect("/profile?saved=1");
}));

router.post("/profile/senha", requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.user.id);
  if (!user) return res.redirect("/login");

  const current = asString(req.body.current);
  const next = asString(req.body.next);
  const confirm = asString(req.body.confirm);
  const fail = (errors) => renderProfile(res, user, { tab: "pw", errors, status: 400 });

  if (!current) return fail({ current: "Informe a senha atual." });
  if (next.length < PASSWORD_MIN) return fail({ next: `A nova senha deve ter ao menos ${PASSWORD_MIN} caracteres.` });
  if (Buffer.byteLength(next) > PASSWORD_MAX_BYTES) return fail({ next: "A nova senha é longa demais (máximo de 72 caracteres)." });
  if (next !== confirm) return fail({ confirm: "As senhas não coincidem." });

  // Conta vinculada ao Firebase: a senha atual é conferida lá, que é a fonte da
  // verdade. Conta antiga: bcrypt.
  const useFirebase = !!user.firebaseUid && firebase.isConfigured();
  let fbSession = null;
  let match;
  if (useFirebase) {
    try {
      fbSession = await firebase.signIn(user.email, current);
      match = true;
    } catch (err) {
      if (!firebase.isInvalidCredentials(err)) throw err;
      match = false;
    }
  } else {
    match = await user.comparePassword(current);
  }
  if (!match) return fail({ current: "Senha atual incorreta." });
  if (next === current) return fail({ next: "A nova senha deve ser diferente da atual." });

  if (fbSession) await firebase.changePassword(fbSession.idToken, next);

  const now = new Date();
  user.password = next;
  user.passwordChangedAt = now;
  await user.save();

  // As outras sessões abertas dessa conta deixam de valer; esta continua.
  invalidateUserCache(user._id);
  req.session.authAt = now.getTime();

  res.redirect("/profile?tab=pw&pwSaved=1");
}));

module.exports = router;
