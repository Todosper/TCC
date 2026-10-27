const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["estudante", "professor", "staff"],
      default: "estudante",
    },
    isAdmin: { type: Boolean, default: false },
    status: { type: String, enum: ["ativo", "bloqueado"], default: "ativo" },

    // Momento da última troca/redefinição de senha. Sessões iniciadas antes
    // dele deixam de valer (ver middleware/auth.js).
    passwordChangedAt: { type: Date },

    // ── Integração com o Firebase Authentication ──────────────────────────
    // Todos opcionais: contas antigas (sem esses campos) continuam funcionando.
    // Não use `default` aqui: "ausente" significa "conta ainda não vinculada
    // ao Firebase".
    firebaseUid: { type: String, unique: true, sparse: true },
    emailVerified: { type: Boolean },
    verificationEmailSentAt: { type: Date },
  },
  { timestamps: true }
);

// Gera o hash da senha sempre que ela for alterada.
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Label legível do perfil
userSchema.methods.roleLabel = function () {
  const map = { estudante: "Estudante", professor: "Professor(a)", staff: "Servidor(a) / Staff" };
  return map[this.role] || this.role;
};

// `email` já tem índice único (unique: true acima). `isAdmin` é consultado ao
// excluir, bloquear ou rebaixar administradores (para nunca zerar o número de
// admins) e `createdAt` ordena a listagem de usuários e os contadores do painel.
userSchema.index({ isAdmin: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
