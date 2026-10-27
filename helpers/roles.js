// Texto exibido ao lado do nome de quem comenta no fórum.
const ROLE_LABELS = { estudante: "Estudante", professor: "Professor(a)", staff: "Servidor(a)" };

function authorRoleLabel({ role, isAdmin } = {}) {
  if (isAdmin) return "Staff";
  return ROLE_LABELS[role] || "Estudante";
}

module.exports = { authorRoleLabel };
