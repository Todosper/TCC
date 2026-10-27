// Regras de e-mail usadas no cadastro e no perfil.

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Domínios aceitos em novos cadastros. O padrão é o e-mail acadêmico dos
// alunos (ex.: nome.sobrenome@academico.ifsul.edu.br). Para aceitar outros
// domínios, defina ALLOWED_EMAIL_DOMAINS no .env separando por vírgula.
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || "academico.ifsul.edu.br")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const EMAIL_DOMAIN_MESSAGE = "Use seu e-mail acadêmico do IFSul (nome@academico.ifsul.edu.br).";

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmailFormat(email) {
  return email.length <= 254 && EMAIL_FORMAT.test(email);
}

function isAllowedEmailDomain(email) {
  const at = email.lastIndexOf("@");
  return at > 0 && ALLOWED_EMAIL_DOMAINS.includes(email.slice(at + 1));
}

module.exports = { normalizeEmail, isValidEmailFormat, isAllowedEmailDomain, EMAIL_DOMAIN_MESSAGE, ALLOWED_EMAIL_DOMAINS };
