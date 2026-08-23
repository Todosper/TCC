const crypto = require("crypto");

// Gera um token aleatório (o que vai no link do e-mail e o usuário nunca
// digita manualmente) e seu hash SHA-256 (o que fica salvo no banco). Assim,
// mesmo que o banco vaze, ninguém consegue reconstruir os tokens válidos —
// mesmo princípio de nunca guardar senha em texto puro.
function generateToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

module.exports = { generateToken, hashToken };
