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

// Os comentários de um tópico são buscados por `topic` e ordenados por
// `createdAt`; o mesmo índice atende a contagem de respostas por tópico.
commentSchema.index({ topic: 1, createdAt: 1 });

module.exports = mongoose.model("Comment", commentSchema);
