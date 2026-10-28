const mongoose = require("mongoose");

const voteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { _id: false, timestamps: true }
);

const suggestionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 10, maxlength: 120 },
    description: { type: String, required: true, trim: true, minlength: 30, maxlength: 3000 },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    isAnonymous: { type: Boolean, default: false },
    moderationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: { type: String, trim: true, maxlength: 1000, default: "" },
    // Termos proibidos encontrados pela moderação automática (helpers/moderation.js).
    flaggedTerms: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["analysis", "planned", "implemented", "not_implemented"],
      default: "analysis",
    },
    statusReason: { type: String, trim: true, maxlength: 1000, default: "" },
    publishedAt: { type: Date, default: null },
    votes: { type: [voteSchema], default: [] },
  },
  { timestamps: true }
);

suggestionSchema.index({ moderationStatus: 1, publishedAt: -1 });
suggestionSchema.index({ "votes.user": 1 });
// Sugestões de um autor (aba "Minha atividade" do perfil).
suggestionSchema.index({ author: 1, createdAt: -1 });

module.exports = mongoose.model("Suggestion", suggestionSchema);
