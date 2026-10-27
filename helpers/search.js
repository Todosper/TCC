// Escapa caracteres especiais de regex antes de usar um texto digitado pelo
// usuário dentro de um $regex do MongoDB. Sem isso, alguém poderia digitar uma
// expressão regular cara de avaliar (ReDoS) ou com comportamento inesperado.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Monta um filtro "contém" (sem diferenciar maiúsculas) seguro para o texto buscado.
// Ex.: buildSearchRegex("prova final") -> { $regex: "prova final", $options: "i" }
function buildSearchRegex(term) {
  return { $regex: escapeRegex(term.trim()), $options: "i" };
}

module.exports = { escapeRegex, buildSearchRegex };
