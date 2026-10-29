// Junta os arquivos de public/css em um único CSS minificado (em memória).
//
// A ORDEM dos arquivos é a mesma dos <link> que existiam em views/layout.ejs: a
// cascata do CSS depende dela. Se criar um novo arquivo CSS, acrescente-o aqui,
// na posição desejada.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CSS_DIR = path.join(__dirname, "..", "public", "css");
const CSS_FILES = [
  "main.css",
  "navbar.css",
  "home.css",
  "forms.css",
  "forum.css",
  "faq.css",
  "admin.css",
  "suggestions.css",
  "accessibility.css",
];

// Minificação conservadora: só remove o que nunca muda o significado do CSS
// (comentários, quebras de linha, espaços ao redor de { } ; , e o último ";" de
// cada bloco). Textos entre aspas e url(...) são copiados exatamente como estão.
// Não mexe em espaços perto de ":", ">", "+" e "~", onde podem ser significativos
// (seletores descendentes, calc()).
function minifyCss(css) {
  let out = "";
  let i = 0;
  const n = css.length;
  let pendingSpace = false;

  const lastChar = () => out[out.length - 1];
  const emit = (text) => {
    if (pendingSpace) {
      const last = lastChar();
      // Espaço só é mantido se não estiver ao lado de { } ; , (nem no início).
      if (last !== undefined && !"{};,".includes(last) && !"{};,".includes(text[0])) out += " ";
      pendingSpace = false;
    }
    out += text;
  };

  while (i < n) {
    const ch = css[i];

    // comentário
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      pendingSpace = true;
      continue;
    }

    // texto entre aspas
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && css[j] !== ch) j += css[j] === "\\" ? 2 : 1;
      emit(css.slice(i, j + 1));
      i = j + 1;
      continue;
    }

    // url(...) sem aspas: conteúdo copiado sem alteração
    if ((ch === "u" || ch === "U") && /^url\(/i.test(css.slice(i, i + 4))) {
      let j = i + 4;
      while (j < n && /\s/.test(css[j])) j++;
      if (css[j] !== '"' && css[j] !== "'") {
        const end = css.indexOf(")", j);
        const stop = end === -1 ? n : end + 1;
        emit(css.slice(i, stop));
        i = stop;
        continue;
      }
    }

    // espaço em branco
    if (/\s/.test(ch)) {
      pendingSpace = true;
      i++;
      continue;
    }

    // ";" logo antes de "}" é desnecessário
    if (ch === "}") {
      if (lastChar() === ";") out = out.slice(0, -1);
      pendingSpace = false;
      out += ch;
      i++;
      continue;
    }

    emit(ch);
    i++;
  }
  return out;
}

// Confere se as chaves de cada arquivo fecham: um bloco aberto engoliria as
// regras do arquivo seguinte depois de juntados.
function assertBalanced(name, css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) throw new Error(`CSS com chaves desbalanceadas em ${name}`);
}

// Retorna { css, hash } ou null se algo falhar (o layout então volta a usar os
// arquivos separados, ver server.js).
function buildCssBundle() {
  try {
    const parts = CSS_FILES.map((name) => {
      const raw = fs.readFileSync(path.join(CSS_DIR, name), "utf8");
      assertBalanced(name, raw);
      return minifyCss(raw);
    });
    const css = parts.join("\n");
    return { css, hash: crypto.createHash("md5").update(css).digest("hex").slice(0, 10) };
  } catch (err) {
    console.error("⚠️  Não foi possível juntar o CSS; usando os arquivos separados:", err.message);
    return null;
  }
}

module.exports = { buildCssBundle, minifyCss, CSS_FILES };
