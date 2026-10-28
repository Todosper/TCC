// Moderação automática de textos publicados no site.
//
// Duas listas:
//   PROFANITY  palavrões. A palavra é censurada ("porra" -> "p@##@") e o texto
//              é publicado normalmente.
//   BLOCKED    palavras e expressões que indicam crime, golpe, spam ou conteúdo
//              proibido. O texto NÃO é publicado: fica retido para um
//              administrador analisar.
//
// A comparação ignora maiúsculas, acentos, letras repetidas ("poooorra") e
// trocas comuns de letras por símbolos ("p0rr@"), e só vale para palavras
// inteiras (assim "cu" não pega "cultura" nem "puta" pega "disputa").

const PROFANITY = [
  "porra", "caralho", "karalho", "caraio", "carai", "krl",
  "cacete", "merda", "bosta",
  "buceta", "xoxota", "xereca", "piroca", "punheta", "siririca",
  "puta", "puto", "pqp", "fdp", "vsf", "vtnc",
  "foda", "foder", "fodido", "fodida", "fodendo", "foda-se", "fodase",
  "cu", "cuzao", "arrombado", "arrombada",
  "fuck", "fucking", "shit", "bitch",
];

const BLOCKED = [
  // Publicidade e promoções indesejadas
  "Ganhe dinheiro rápido",
  "Trabalho fácil online",
  "Aposte",
  "Clique aqui para um presente",
  "Oferta",
  "Compre agora e ganhe um bônus",
  "Desconto",
  "Milhões de seguidores instantaneamente",
  "Aumente seu engajamento agora",
  "Sorteio",
  "Envie um PIX para receber seu prêmio",

  // Promoção de pornografia e violência
  "Acesse agora vídeos exclusivos",
  "Conteúdo adulto gratuito",
  "Mulheres solteiras na sua região",
  "Pornô",
  "Clique para ver sem censura",
  "A melhor plataforma de conteúdo explícito",
  "Conteúdo adulto",
  "Nuas",
  "Lute até a morte",
  "Vídeos sangrentos",
  "Download grátis de material proibido",
  "Participe da comunidade sem regras",

  // Golpes na internet e esquemas financeiros
  "Ganhe muito dinheiro por dia sem esforço",
  "Investimento garantido, sem riscos",
  "Enriqueça",
  "Deposite agora e veja seu dinheiro multiplicar",
  "Trabalhe de casa e fique rico",
  "Renda extra",
  "Esquema secreto para ficar milionário",
  "Mude de vida com esse método infalível",
  "Convide 5 amigos e comece a lucrar",
  "Faça uma transferência para ativar sua conta premium",

  // Nazismo e discurso de ódio
  "nazismo", "nazista", "neonazismo", "neonazista", "nazi",
  "heil hitler", "sieg heil", "supremacia branca", "supremacista",
  "white power", "ku klux klan",
  "crioulo", "preto imundo", "negro imundo", "viado", "traveco", "sapatão",

  // Ameaças e incitação à violência
  "vou te matar", "vou matar vocês", "vou matar todos",
  "vou explodir a escola", "vou explodir o campus",
  "ataque à escola", "ataque na escola", "ataque ao campus",
  "massacre na escola", "tiroteio na escola", "atirar na escola", "atirar em todos",
  "vou estuprar", "vou te estuprar",

  // Abuso sexual infantil
  "pornografia infantil", "pedofilia", "pedófilo",

  // Drogas e documentos falsos
  "vendo drogas", "vendo maconha", "vendo cocaína", "vendo crack", "venda de drogas",
  "atestado falso", "diploma falso", "documento falso",
];

// ─── Normalização ───────────────────────────────────────────────────────────
// Letras e números que costumam substituir letras para burlar filtros.
const LOOKALIKES = { "@": "a", "4": "a", "3": "e", "1": "i", "0": "o", "$": "s" };

// Devolve o texto normalizado (minúsculas, sem acentos, sem letras repetidas em
// sequência) e, para cada caractere dele, onde começa e termina no original.
// Esse mapa permite censurar o trecho certo do texto que a pessoa digitou.
function normalize(text) {
  let norm = "";
  const starts = [];
  const ends = [];
  let pos = 0;

  for (const ch of String(text)) {
    const start = pos;
    pos += ch.length;

    const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
    if (base === "") {
      // Acento solto: pertence ao caractere anterior.
      if (ends.length) ends[ends.length - 1] = pos;
      continue;
    }

    for (let c of base.toLowerCase()) {
      if (LOOKALIKES[c]) c = LOOKALIKES[c];
      // Emojis ocupam 2 posições no texto; viram um espaço para que cada
      // posição do texto normalizado corresponda a uma entrada do mapa.
      if (c.length > 1) c = " ";
      const last = norm[norm.length - 1];
      if (last === c && /[a-z]/.test(c)) {
        ends[ends.length - 1] = pos;
        continue;
      }
      norm += c;
      starts.push(start);
      ends.push(pos);
    }
  }
  return { norm, starts, ends };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Monta o regex de um termo. Entre as palavras de uma expressão vale qualquer
// espaço ou pontuação, e termos de uma só palavra aceitam o plural ("oferta"
// pega "ofertas").
function buildRegex(term) {
  const tokens = normalize(term).norm.split(/[^a-z0-9]+/).filter(Boolean);
  const body = tokens.map(escapeRegex).join("[^a-z0-9]+");
  const plural = tokens.length === 1 ? "s?" : "";
  return new RegExp(`(?<![a-z0-9])${body}${plural}(?![a-z0-9])`, "g");
}

const profanityRules = PROFANITY.map((term) => ({ term, regex: buildRegex(term) }));
const blockedRules = BLOCKED.map((term) => ({ term, regex: buildRegex(term) }));

// ─── Censura ────────────────────────────────────────────────────────────────
// Mantém a primeira letra; vogais viram "@" e o restante vira "#".
// "porra" -> "p@##@", "caralho" -> "c@#@##@". O tamanho do texto não muda.
function maskWord(original) {
  let first = true;
  let out = "";
  for (const ch of original) {
    if (/[\s\-_]/.test(ch)) {
      out += ch;
    } else if (first) {
      first = false;
      out += ch;
    } else {
      const letter = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      out += /^[aeiou]$/.test(letter) ? "@" : "#";
    }
  }
  return out;
}

function censorText(text, map) {
  const spans = [];
  for (const rule of profanityRules) {
    for (const match of map.norm.matchAll(rule.regex)) {
      const last = match.index + match[0].length - 1;
      spans.push({ start: map.starts[match.index], end: map.ends[last] });
    }
  }
  if (spans.length === 0) return { text, censored: false };

  // Trechos que se sobrepõem (ex.: "foda" dentro de "foda-se") viram um só.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && span.start < prev.end) prev.end = Math.max(prev.end, span.end);
    else merged.push({ ...span });
  }

  let result = "";
  let cursor = 0;
  for (const span of merged) {
    result += text.slice(cursor, span.start) + maskWord(text.slice(span.start, span.end));
    cursor = span.end;
  }
  result += text.slice(cursor);
  return { text: result, censored: true };
}

function findBlockedTerms(map) {
  return blockedRules.filter((rule) => map.norm.search(rule.regex) !== -1).map((rule) => rule.term);
}

// Analisa um conjunto de campos de texto de uma mesma postagem.
//   moderateFields({ title, body }) ->
//   { values: { title, body }  textos já com os palavrões censurados,
//     blocked: true/false      há termo proibido em algum campo,
//     blockedTerms: [...]      termos proibidos encontrados,
//     censored: true/false }   algum palavrão foi censurado
function moderateFields(fields) {
  const values = {};
  const blockedTerms = new Set();
  let censored = false;

  for (const [name, raw] of Object.entries(fields)) {
    const text = typeof raw === "string" ? raw : "";
    const map = normalize(text);
    findBlockedTerms(map).forEach((term) => blockedTerms.add(term));
    const result = censorText(text, map);
    values[name] = result.text;
    if (result.censored) censored = true;
  }

  return { values, blocked: blockedTerms.size > 0, blockedTerms: [...blockedTerms], censored };
}

module.exports = { moderateFields, PROFANITY, BLOCKED };
