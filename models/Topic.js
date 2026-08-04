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
    content: { type: String, required: true, trim: true, minlength: 30 },
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

module.exports = mongoose.model("Topic", topicSchema);
