// Utilitários para ler parâmetros de query string e paginar listagens.

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// Garante que o valor vindo da query string é um texto. Com o parser
// `extended: true`, `?q=a&q=b` vira um array e `?q[x]=1` vira um objeto — o que
// fazia `q.trim()` estourar (erro 500) e deixava `?cat[$ne]=x` virar um
// operador do MongoDB no filtro. Qualquer coisa que não seja texto vira "".
function queryString(value) {
  return typeof value === "string" ? value : "";
}

function isObjectIdString(value) {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

const MAX_PAGE = 100000;

function parsePage(raw) {
  const n = parseInt(raw, 10);
  // NaN/zero/negativo → 1. Valores enormes (inclusive Infinity) são limitados,
  // o que depois leva à última página, como antes.
  return n > 0 ? Math.min(n, MAX_PAGE) : 1;
}

// Paginação que faz a contagem e a busca da página AO MESMO TEMPO (antes eram
// duas idas seguidas ao banco). No caso raro de a página pedida ser maior que a
// última, refaz a busca já na última página — mesmo comportamento de antes.
//
//   count(): () => Promise<number>
//   find(skip, limit): (number, number) => Query | Aggregate | Promise
async function paginate({ count, find, page, pageSize }) {
  const requested = parsePage(page);
  const [total, firstItems] = await Promise.all([count(), find((requested - 1) * pageSize, pageSize)]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (requested <= totalPages) {
    return { items: firstItems, total, totalPages, page: requested };
  }
  const items = await find((totalPages - 1) * pageSize, pageSize);
  return { items, total, totalPages, page: totalPages };
}

module.exports = { queryString, isObjectIdString, parsePage, paginate };
