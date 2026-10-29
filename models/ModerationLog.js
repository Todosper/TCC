const mongoose = require("mongoose");

// Histórico das ações de moderação feitas no painel de administração
// ("Fulano excluiu a resposta X"). Cada registro guarda uma cópia do nome do
// administrador e uma frase pronta, para continuar legível mesmo depois que o
// conteúdo ou a conta citados forem excluídos.
const CATEGORIES = ["forum", "reports", "held", "suggestions", "faq", "users"];

const moderationLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    adminName: { type: String, required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    description: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Listagem: mais recentes primeiro, com ou sem filtro por categoria.
moderationLogSchema.index({ createdAt: -1 });
moderationLogSchema.index({ category: 1, createdAt: -1 });

const ModerationLog = mongoose.model("ModerationLog", moderationLogSchema);
ModerationLog.CATEGORIES = CATEGORIES;

module.exports = ModerationLog;
