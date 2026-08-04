const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, required: true },
    text: { type: String, required: true, trim: true, minlength: 10 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Comment", commentSchema);
