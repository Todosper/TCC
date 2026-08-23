const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, required: true },
    text: { type: String, required: true, trim: true, minlength: 10, maxlength: 3000 },
  },
  { timestamps: true }
);

// Toda vez que um tópico é aberto, os comentários são buscados por `topic` e
// ordenados por `createdAt` (ver routes/main.js) — este índice composto
// atende exatamente esse padrão. Também acelera a contagem agregada de
// respostas por tópico usada nas listagens do fórum.
commentSchema.index({ topic: 1, createdAt: 1 });

module.exports = mongoose.model("Comment", commentSchema);
