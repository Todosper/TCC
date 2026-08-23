const Notification = require("../models/Notification");

async function createNotification(recipientId, type, message, link) {
  try {
    await Notification.create({ recipient: recipientId, type, message, link });
  } catch (err) {
    console.error("Erro ao criar notificação:", err);
  }
}

module.exports = { createNotification };
