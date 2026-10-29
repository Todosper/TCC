// Hash e conferência de senhas.
//
// Usa o pacote "bcrypt" (código nativo, bem mais rápido) quando ele está
// instalado e consegue ser carregado; caso contrário, cai no "bcryptjs"
// (JavaScript puro), que continua nas dependências. Os dois geram e conferem o
// mesmo formato de hash ($2a$/$2b$), então as senhas já salvas funcionam com
// qualquer um deles e dá para alternar sem migrar nada.
//
// Para ativar o nativo: `npm install bcrypt --save-optional` (como opcional, uma
// falha de compilação na hospedagem não impede o deploy: o site só usa o
// bcryptjs e registra um aviso no log).
let impl = null;
let implementation = "bcryptjs";

try {
  impl = require("bcrypt");
  implementation = "bcrypt";
} catch (err) {
  // "Cannot find module 'bcrypt'" = não instalado (situação normal, sem aviso).
  // Qualquer outro erro = instalado, mas o binário nativo não carregou.
  const notInstalled = err && err.code === "MODULE_NOT_FOUND" && /['"]bcrypt['"]/.test(err.message || "");
  if (!notInstalled) console.warn("⚠️  bcrypt nativo não pôde ser carregado; usando bcryptjs:", err && err.message);
  impl = require("bcryptjs");
}

console.log(`🔐 Senhas: usando ${implementation === "bcrypt" ? "bcrypt (nativo)" : "bcryptjs (JavaScript)"}.`);

module.exports = {
  implementation,
  genSalt: (rounds) => impl.genSalt(rounds),
  hash: (data, salt) => impl.hash(data, salt),
  compare: (data, hash) => impl.compare(data, hash),
};
