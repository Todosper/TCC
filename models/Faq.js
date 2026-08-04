const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "FaqCategory", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Faq", faqSchema);
