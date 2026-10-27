// Valida o destino de um redirecionamento pedido pelo navegador (ex.: ?next=).
// Só aceita caminhos internos do próprio site; qualquer outra coisa volta para "/".
const BLOCKED_PREFIXES = ["/login", "/register", "/logout", "/forgot-password"];

function safeNext(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return "/";
  if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  if (BLOCKED_PREFIXES.some((p) => value === p || value.startsWith(p + "?") || value.startsWith(p + "/"))) return "/";
  return value;
}

module.exports = { safeNext };
