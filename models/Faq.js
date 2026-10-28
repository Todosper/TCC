const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    // Texto longo, opcional. Quando existe, a pergunta ganha uma página própria
    // (/faq/:id) e a resposta curta passa a trazer um link para ela.
    details: { type: String, trim: true, default: "" },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "FaqCategory", required: true },
  },
  { timestamps: true }
);

// Filtro por categoria (página de FAQ), contagem por categoria e listagem do
// painel admin (mais recentes primeiro).
faqSchema.index({ category: 1 });
faqSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Faq", faqSchema);
