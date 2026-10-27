const mongoose = require("mongoose");

// Denúncias de conteúdo do fórum (tópico ou comentário), feitas por qualquer
// usuário autenticado e revisadas pela moderação.
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

// O primeiro índice atende a fila de moderação (por status e data); o segundo
// atende a checagem de denúncia repetida da mesma pessoa sobre o mesmo conteúdo.
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reporter: 1, topic: 1, comment: 1 });

module.exports = mongoose.model("Report", reportSchema);
