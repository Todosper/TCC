const Notification = require("../models/Notification");
const TopicFollow = require("../models/TopicFollow");

async function createNotification(recipientId, type, message, link) {
  try {
    await Notification.create({ recipient: recipientId, type, message, link });
  } catch (err) {
    console.error("Erro ao criar notificação:", err);
  }
}

// Avisa quem segue o tópico que alguém respondeu. Não avisa quem respondeu nem
// o autor do tópico (ele já recebe o aviso próprio de resposta).
async function notifyTopicFollowers(topic, replierId, replierName) {
  try {
    const follows = await TopicFollow.find({ topic: topic._id }).select("user").lean();
    const skip = new Set([String(replierId), String(topic.author)]);
    const docs = follows
      .filter((f) => !skip.has(String(f.user)))
      .map((f) => ({
        recipient: f.user,
        type: "forum_reply",
        message: `${replierName} respondeu ao tópico "${topic.title}" que você segue`,
        link: `/forum/topico/${topic._id}`,
      }));
    if (docs.length > 0) await Notification.insertMany(docs, { ordered: false });
  } catch (err) {
    console.error("Erro ao notificar seguidores do tópico:", err);
  }
}

module.exports = { createNotification, notifyTopicFollowers };
