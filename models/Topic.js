const mongoose = require("mongoose");
const { CATEGORIES } = require("./categories");

const topicSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 10, maxlength: 120 },
    category: {
      type: String,
      required: true,
      enum: CATEGORIES.map((c) => c.id),
    },
    content: { type: String, required: true, trim: true, minlength: 30, maxlength: 5000 },
    tags: [{ type: String, trim: true }],
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true }, // cópia do nome para exibição sem consulta extra
    views: { type: Number, default: 0 },
    locked: { type: Boolean, default: false },
    // Resposta marcada como solução pelo autor do tópico (ou pela moderação).
    solvedComment: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null },
  },
  { timestamps: true }
);

// "Recente" = criado nas últimas 48h. O nome `isNew` não pode ser usado porque
// o Mongoose já o utiliza internamente.
topicSchema.virtual("isRecent").get(function () {
  if (!this.createdAt) return true;
  const diffMs = Date.now() - this.createdAt.getTime();
  return diffMs < 1000 * 60 * 60 * 48;
});

topicSchema.set("toJSON", { virtuals: true });
topicSchema.set("toObject", { virtuals: true });

// Índices das consultas do app: listagem por data (padrão), filtro por
// categoria combinado com data e ordenação por popularidade.
topicSchema.index({ createdAt: -1 });
topicSchema.index({ category: 1, createdAt: -1 });
// Ordenação por popularidade: `views` sozinho tem muitos empates (todo tópico
// novo começa com 0), e com empates a paginação poderia repetir ou pular
// tópicos. O desempate por data deixa a ordem estável.
topicSchema.index({ views: -1, createdAt: -1 });
topicSchema.index({ category: 1, views: -1, createdAt: -1 });
// Tópicos de um autor (aba "Minha atividade" do perfil).
topicSchema.index({ author: 1, createdAt: -1 });

module.exports = mongoose.model("Topic", topicSchema);
