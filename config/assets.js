// Versão dos arquivos estáticos (CSS/JS) usada para "cache busting".
//
// Os assets são servidos com cache longo em produção (ver server.js). Para que
// uma nova versão do site nunca fique presa no cache do navegador, o layout
// acrescenta ?v=<hash> às URLs dos CSS/JS. O hash é calculado uma única vez, na
// subida do servidor, a partir do conteúdo dos arquivos: muda se (e somente se)
// algum CSS/JS mudar.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function computeAssetVersion() {
  try {
    const hash = crypto.createHash("md5");
    for (const dir of ["css", "js"]) {
      const full = path.join(__dirname, "..", "public", dir);
      const files = fs
        .readdirSync(full, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
      for (const file of files) {
        hash.update(file);
        hash.update(fs.readFileSync(path.join(full, file)));
      }
    }
    return hash.digest("hex").slice(0, 10);
  } catch (err) {
    // Qualquer falha de leitura: usa o horário da subida (continua funcionando,
    // só perde a estabilidade do hash entre reinícios).
    return String(Date.now());
  }
}

module.exports = { assetVersion: computeAssetVersion() };
