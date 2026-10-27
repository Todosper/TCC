// Indica se quem fez o pedido prefere JSON a HTML (chamadas fetch do site enviam
// "Accept: application/json"; envios de formulário normais não).
function wantsJson(req) {
  return req.accepts(["html", "json"]) === "json";
}

module.exports = { wantsJson };
