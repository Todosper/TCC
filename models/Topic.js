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
    authorName: { type: String, required: true }, // cache do nome p/ exibição rápida
    views: { type: Number, default: 0 },
    locked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Virtual: é "recente" se foi criado nas últimas 48h
// NOTE: Não usar o nome `isNew` porque Mongoose já o utiliza internamente.
topicSchema.virtual("isRecent").get(function () {
  if (!this.createdAt) return true;
  const diffMs = Date.now() - this.createdAt.getTime();
  return diffMs < 1000 * 60 * 60 * 48;
});

topicSchema.set("toJSON", { virtuals: true });
topicSchema.set("toObject", { virtuals: true });

// Índices alinhados aos padrões de consulta reais do app (ver routes/main.js
// e routes/admin.js): listagem por data (padrão), filtro por categoria
// combinado com data, e ordenação por popularidade. Sem eles, o MongoDB faz
// uma varredura completa da coleção a cada listagem — imperceptível com
// poucos tópicos, mas cada vez mais caro conforme o fórum cresce (ver
// seção 9 da auditoria, especialmente os Cenários C/D).
topicSchema.index({ createdAt: -1 });
topicSchema.index({ category: 1, createdAt: -1 });
// Ordenação por popularidade: `views` sozinho tem MUITOS empates (todo tópico novo
// tem 0 visualizações), e com empates a paginação do MongoDB pode repetir ou
// pular tópicos entre uma página e outra. O desempate por data deixa a ordem
// estável, e estes índices cobrem exatamente essa ordenação (com e sem filtro
// de categoria). O antigo índice só em `views` passou a ser redundante.
topicSchema.index({ views: -1, createdAt: -1 });
topicSchema.index({ category: 1, views: -1, createdAt: -1 });

module.exports = mongoose.model("Topic", topicSchema);
