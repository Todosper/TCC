const mongoose = require("mongoose");

const faqCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  icon: { type: String, default: "HelpCircle" }, // nome do ícone (lucide) usado na home
  cls: { type: String, default: "faqcat-green" }, // classe css de cor de fundo
});

module.exports = mongoose.model("FaqCategory", faqCategorySchema);
