const ModerationLog = require("../models/ModerationLog");

// Trecho curto de um texto, para citar conteúdo no histórico.
function excerpt(text, max = 80) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// Registra uma ação do administrador logado. Nunca interrompe a ação em si: se
// o registro falhar, só escreve o erro no log do servidor.
async function logModeration(req, category, description) {
  try {
    await ModerationLog.create({
      admin: req.session.user.id,
      adminName: req.session.user.name,
      category,
      description: String(description).slice(0, 500),
    });
  } catch (err) {
    console.error("Erro ao registrar ação de moderação:", err);
  }
}

module.exports = { logModeration, excerpt };
