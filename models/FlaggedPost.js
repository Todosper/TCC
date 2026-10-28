const mongoose = require("mongoose");

// Tópicos e respostas do fórum que a moderação automática bloqueou por conter
// termos proibidos (ver helpers/moderation.js). Ficam aqui, sem aparecer no
// site, até um administrador aprovar (a postagem é publicada) ou rejeitar.
const flaggedPostSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["topic", "comment"], required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, default: "" },

    // Só para type === "topic".
    title: { type: String, trim: true, default: "" },
    category: { type: String, default: "" },
    // Só para type === "comment": tópico em que a resposta seria publicada.
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", default: null },

    // Descrição do tópico ou texto da resposta (palavrões já censurados).
    content: { type: String, required: true },
    blockedTerms: { type: [String], default: [] },

    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Fila de moderação (por status e data) e limpeza ao excluir um usuário.
flaggedPostSchema.index({ status: 1, createdAt: 1 });
flaggedPostSchema.index({ author: 1 });

module.exports = mongoose.model("FlaggedPost", flaggedPostSchema);
