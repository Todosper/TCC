// Escapa caracteres especiais de regex antes de usar um texto digitado pelo
// usuário dentro de um $regex do MongoDB. Sem isso, alguém pode digitar uma
// expressão regular propositalmente cara de avaliar (ReDoS) ou com
// comportamento inesperado como termo de busca — ver P-19 da auditoria.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Constrói um filtro de busca "contém" seguro para um ou mais campos.
// Ex.: buildSearchFilter("prova final", ["title"]) ->
//      { title: { $regex: "prova final" (escapado), $options: "i" } }
function buildSearchRegex(term) {
  return { $regex: escapeRegex(term.trim()), $options: "i" };
}

module.exports = { escapeRegex, buildSearchRegex };
