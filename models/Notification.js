const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["forum_reply", "forum_solution", "suggestion_approved", "suggestion_rejected", "suggestion_status", "post_approved", "post_rejected"],
      required: true,
    },
    message: { type: String, required: true },
    link: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

// Índice TTL: o próprio MongoDB apaga as notificações com mais de 30 dias (lidas
// ou não), para a coleção não crescer sem parar. A limpeza roda em segundo plano
// a cada ~60 segundos, sem nenhum código no servidor.
const NOTIFICATION_TTL_SECONDS = 30 * 24 * 60 * 60;
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });

module.exports = mongoose.model("Notification", notificationSchema);
