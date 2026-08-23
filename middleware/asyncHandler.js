// O Express 4 não captura automaticamente uma Promise rejeitada dentro de um
// handler `async (req, res) => {...}`. Sem isso, um erro assíncrono não
// tratado (ex.: um ObjectId inválido em findById) deixa a requisição travada
// para sempre, sem nunca responder ao navegador.
//
// Este wrapper envolve o handler e, se a Promise rejeitar, encaminha o erro
// para next(err) — que cai no middleware de erro global definido em
// server.js. Uso: router.get("/rota", asyncHandler(async (req, res) => {...}))
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
