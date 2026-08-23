const mongoose = require("mongoose");

// Denúncias de conteúdo do fórum (tópico ou comentário), feitas por qualquer
// usuário autenticado. Resolve P-29 da auditoria: antes não existia nenhum
// mecanismo para um usuário sinalizar conteúdo problemático a um admin.
const reportSchema = new mongoose.Schema(
  {
    // Um report é sempre sobre um Topic OU um Comment, nunca os dois.
    targetType: { type: String, enum: ["topic", "comment"], required: true },
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", required: true },
    // Preenchido apenas quando targetType === "comment".
    comment: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null },

    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: {
      type: String,
      enum: ["spam", "offensive", "personal_info", "off_topic", "other"],
      required: true,
    },
    details: { type: String, trim: true, maxlength: 500, default: "" },

    status: { type: String, enum: ["pending", "reviewed", "dismissed"], default: "pending" },
  },
  { timestamps: true }
);

// Acelera a fila de moderação (mais recentes/pendentes primeiro) e evita que
// a mesma pessoa denuncie o mesmo conteúdo repetidamente sem necessidade.
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reporter: 1, topic: 1, comment: 1 });

module.exports = mongoose.model("Report", reportSchema);
