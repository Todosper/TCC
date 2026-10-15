const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["estudante", "professor", "staff"],
      default: "estudante",
    },
    isAdmin: { type: Boolean, default: false },
    status: { type: String, enum: ["ativo", "bloqueado"], default: "ativo" },

    // ── Integração com o Firebase Authentication ──────────────────────────
    // Todos opcionais: usuários antigos (sem esses campos) continuam
    // funcionando normalmente. Não ponha `default` aqui: "ausente" significa
    // "conta antiga, ainda não vinculada ao Firebase".
    firebaseUid: { type: String, unique: true, sparse: true },
    emailVerified: { type: Boolean },
    verificationEmailSentAt: { type: Date },
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

// `email` já tem índice único (unique: true acima). Os dois abaixo apoiam
// consultas reais do app: `isAdmin` é checado a cada exclusão/mudança de
// status de admin para impedir zerar os administradores (ver routes/admin.js),
// e `createdAt` é usado na listagem padrão de usuários e nos contadores do
// dashboard.
userSchema.index({ isAdmin: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
