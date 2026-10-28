// Regras de conta ligadas ao e-mail e ao login com o Google.
//
//  - Conta nova só nasce com e-mail de um domínio permitido
//    (ALLOWED_EMAIL_DOMAINS), seja pelo formulário ou pelo Google.
//  - Depois de criada, a conta pode trocar de e-mail (confirmado pelo Google).
//  - Todo e-mail que uma conta já teve fica registrado (User.emailHistory) e
//    nunca mais serve para criar outra conta nem para outra conta usar.

const crypto = require("crypto");
const User = require("../models/User");
const firebase = require("./firebase");
const { isAllowedEmailDomain } = require("./email");

const NAME_MAX = 100;
const NAME_MIN = 2;

// O e-mail está em uso ou já foi usado por alguma conta (que não seja
// `exceptUserId`)?
async function isEmailTaken(email, exceptUserId) {
  const query = { $or: [{ email }, { emailHistory: email }] };
  if (exceptUserId) query._id = { $ne: exceptUserId };
  return !!(await User.exists(query));
}

function nameFromGoogle(profile) {
  const name = profile.name.slice(0, NAME_MAX).trim();
  return name.length >= NAME_MIN ? name : profile.email.split("@")[0].slice(0, NAME_MAX);
}

// Entra (ou cria a conta) com o perfil devolvido pelo Google.
// Retorna { user } ou { error }, com error em:
//   "blocked"       conta bloqueada
//   "other-google"  o e-mail da conta está ligado a outra conta Google
//   "domain"        conta nova, mas o e-mail não é de um domínio permitido
//   "taken"         o e-mail já foi de uma conta que hoje usa outro e-mail
async function resolveGoogleLogin(profile) {
  const { sub, email } = profile;

  let user = await User.findOne({ googleId: sub });
  if (!user) {
    user = await User.findOne({ email });
    if (user) {
      if (user.googleId && user.googleId !== sub) return { error: "other-google" };
      user.googleId = sub;
    }
  }

  if (user) {
    if (user.status === "bloqueado") return { error: "blocked" };
    // O Google confirmou o e-mail.
    if (user.emailVerified !== true) user.emailVerified = true;
    if (user.isModified()) await user.save();
    return { user };
  }

  // Nenhuma conta: criar exige e-mail de domínio permitido e nunca usado.
  if (!isAllowedEmailDomain(email)) return { error: "domain" };
  if (await isEmailTaken(email)) return { error: "taken" };

  const created = await User.create({
    name: nameFromGoogle(profile),
    email,
    // A conta entra pelo Google; esta senha ninguém conhece. Quem quiser
    // entrar com senha usa "Esqueci minha senha".
    password: crypto.randomBytes(32).toString("base64url"),
    googleId: sub,
    emailVerified: true,
    emailHistory: [email],
  });
  return { user: created };
}

// Troca o e-mail da conta pelo e-mail da conta Google que a pessoa acabou de
// confirmar. Retorna { ok: true } ou { error: "same" | "taken" }.
async function changeEmailWithGoogle(user, profile) {
  const { sub, email } = profile;
  if (email === user.email) return { error: "same" };
  if (await isEmailTaken(email, user._id)) return { error: "taken" };
  if (await User.exists({ googleId: sub, _id: { $ne: user._id } })) return { error: "taken" };

  const oldEmail = user.email;

  // Mantém o Firebase (senha e e-mails de recuperação) com o mesmo e-mail da
  // conta. Se não der para atualizá-lo, a conta guarda com qual e-mail ela
  // existe lá, e a entrada por senha continua funcionando.
  let firebaseUpdated = false;
  if (user.firebaseUid) {
    let synced = false;
    if (firebase.isAdminConfigured()) {
      try {
        await firebase.updateUserEmail(user.firebaseUid, email);
        synced = true;
        firebaseUpdated = true;
      } catch (err) {
        if (err && err.code === "auth/email-already-exists") return { error: "taken" };
        if (err && err.code === "auth/user-not-found") synced = true;
        else console.error(`Falha ao atualizar o e-mail de ${oldEmail} no Firebase:`, err && err.message);
      }
    }
    user.firebaseEmail = synced ? undefined : user.firebaseEmail || oldEmail;
  }

  user.email = email;
  user.googleId = sub;
  user.emailVerified = true;
  user.emailHistory = [...new Set([...(user.emailHistory || []), oldEmail, email])];

  try {
    await user.save();
  } catch (err) {
    // Não deixa o Firebase com um e-mail diferente do site.
    if (firebaseUpdated) await firebase.updateUserEmail(user.firebaseUid, oldEmail).catch(() => {});
    if (err && err.code === 11000) return { error: "taken" };
    throw err;
  }
  return { ok: true };
}

module.exports = { isEmailTaken, resolveGoogleLogin, changeEmailWithGoogle };
