// Utilitários para ler parâmetros de query string / corpo de formulário e paginar listagens.

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// Garante que o valor recebido é um texto. Com o parser `extended: true`,
// `?q=a&q=b` vira um array e `?q[x]=1` vira um objeto, o que faria `q.trim()`
// falhar (erro 500) ou deixaria `?cat[$ne]=x` virar um operador do MongoDB no
// filtro. Qualquer coisa que não seja texto vira "".
function asString(value) {
  return typeof value === "string" ? value : "";
}

function isObjectIdString(value) {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

const MAX_PAGE = 100000;

function parsePage(raw) {
  const n = parseInt(raw, 10);
  // NaN, zero ou negativo viram 1. Valores enormes (inclusive Infinity) são
  // limitados e acabam levando à última página.
  return n > 0 ? Math.min(n, MAX_PAGE) : 1;
}

// Pagina uma listagem fazendo a contagem e a busca da página ao mesmo tempo.
// Se a página pedida for maior que a última, repete a busca na última página.
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

// `queryString` é mantido como apelido de `asString` (usado nas rotas existentes).
module.exports = { asString, queryString: asString, isObjectIdString, parsePage, paginate };
