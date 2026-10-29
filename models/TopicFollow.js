const mongoose = require("mongoose");

// Quem segue um tópico recebe uma notificação quando alguém o responde (o autor
// do tópico já é avisado sempre, sem precisar seguir).
const topicFollowSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", required: true },
  },
  { timestamps: true }
);

// Único: a mesma pessoa não segue o mesmo tópico duas vezes (também atende a
// pergunta "esta pessoa segue este tópico?"). O segundo índice atende a busca
// dos seguidores de um tópico ao publicar uma resposta.
topicFollowSchema.index({ user: 1, topic: 1 }, { unique: true });
topicFollowSchema.index({ topic: 1 });

module.exports = mongoose.model("TopicFollow", topicFollowSchema);
