// Remoções em cascata do fórum, compartilhadas pela moderação (routes/admin.js)
// e pela exclusão do próprio conteúdo (routes/main.js).
const Topic = require("../models/Topic");
const Comment = require("../models/Comment");
const Report = require("../models/Report");
const Notification = require("../models/Notification");
const TopicFollow = require("../models/TopicFollow");

// Apaga o tópico, suas respostas, as denúncias sobre ele, quem o segue e as
// notificações que apontam para ele.
async function deleteTopicCascade(topicId) {
  await Promise.all([
    Comment.deleteMany({ topic: topicId }),
    Report.deleteMany({ topic: topicId }),
    TopicFollow.deleteMany({ topic: topicId }),
    Notification.deleteMany({ link: `/forum/topico/${topicId}` }),
    Topic.deleteOne({ _id: topicId }),
  ]);
}

// Apaga uma resposta e as denúncias sobre ela; se era a resposta marcada como
// solução, desfaz a marcação.
async function deleteCommentCascade(comment) {
  await Promise.all([
    Comment.deleteOne({ _id: comment._id }),
    Report.deleteMany({ comment: comment._id }),
    Topic.updateOne({ _id: comment.topic, solvedComment: comment._id }, { $set: { solvedComment: null } }),
  ]);
}

module.exports = { deleteTopicCascade, deleteCommentCascade };
