const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const Notification = require("../models/Notification");

router.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    // Lista e contagem são independentes: buscadas em paralelo.
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.session.user.id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Notification.countDocuments({ recipient: req.session.user.id, read: false }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar notificações." });
  }
});

router.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    // updateOne: não precisa devolver o documento (findOneAndUpdate devolvia).
    await Notification.updateOne(
      { _id: req.params.id, recipient: req.session.user.id },
      { read: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao marcar notificação." });
  }
});

router.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.session.user.id, read: false },
      { read: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao marcar notificações." });
  }
});

module.exports = router;
