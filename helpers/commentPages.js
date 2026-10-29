// Paginação das respostas de um tópico (ver routes/main.js).
const Comment = require("../models/Comment");
const { paginate } = require("./query");

const COMMENTS_PAGE_SIZE = 20;

// Pedir esta "página" leva sempre à última (paginate limita ao total de páginas).
const LAST_PAGE = Number.MAX_SAFE_INTEGER;

// Uma página de respostas, na ordem em que foram publicadas.
function loadCommentsPage(topicId, page) {
  return paginate({
    page,
    pageSize: COMMENTS_PAGE_SIZE,
    count: () => Comment.countDocuments({ topic: topicId }),
    find: (skip, limit) => Comment.find({ topic: topicId }).sort({ createdAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
  });
}

// Em que página do tópico está esta resposta (comment precisa ter topic,
// createdAt e _id). Usada para que links com âncora (#comentario-...) abram a
// página certa.
async function commentPageNumber(comment) {
  const before = await Comment.countDocuments({
    topic: comment.topic,
    $or: [
      { createdAt: { $lt: comment.createdAt } },
      { createdAt: comment.createdAt, _id: { $lt: comment._id } },
    ],
  });
  return Math.floor(before / COMMENTS_PAGE_SIZE) + 1;
}

// Endereço da resposta dentro do tópico, já com o número da página.
// `extraQuery` (ex.: "submitted=1") é acrescentado à query string.
async function commentUrl(comment, extraQuery = "") {
  const page = await commentPageNumber(comment);
  const query = [page > 1 ? `page=${page}` : "", extraQuery].filter(Boolean).join("&");
  return `/forum/topico/${comment.topic}${query ? `?${query}` : ""}#comentario-${comment._id}`;
}

module.exports = { COMMENTS_PAGE_SIZE, LAST_PAGE, loadCommentsPage, commentPageNumber, commentUrl };
