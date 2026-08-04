const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    login: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["estudante", "professor", "staff"],
      default: "estudante",
    },
    isAdmin: { type: Boolean, default: false },
    status: { type: String, enum: ["ativo", "bloqueado"], default: "ativo" },
  },
  { timestamps: true }
);

// Hash da senha antes de salvar
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Label legível do perfil
userSchema.methods.roleLabel = function () {
  const map = { estudante: "Estudante", professor: "Professor(a)", staff: "Servidor(a) / Staff" };
  return map[this.role] || this.role;
};

module.exports = mongoose.model("User", userSchema);
