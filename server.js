require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const methodOverride = require("method-override");
const cookieParser = require("cookie-parser");

const connectDB = require("./config/db");
const { attachUser } = require("./middleware/auth");
const icon = require("./config/icons");
const { assetVersion } = require("./config/assets");
const { catLabel, catCls } = require("./models/categories");
const { doubleCsrfProtection, attachCsrfToken, invalidCsrfTokenError } = require("./middleware/csrf");

const authRoutes = require("./routes/auth");
const mainRoutes = require("./routes/main");
const pageRoutes = require("./routes/pages");
const profileRoutes = require("./routes/profile");
const adminRoutes = require("./routes/admin");
const notificationRoutes = require("./routes/notifications");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

// No Express 4, uma Promise rejeitada dentro de um handler `async` sem
// try/catch vira "unhandledRejection", e a partir do Node 15 isso derruba o
// processo. Aqui o erro só é registrado; cada rota continua responsável por
// tratar os próprios erros (veja middleware/asyncHandler.js).
process.on("unhandledRejection", (reason) => {
  console.error("Promise rejeitada sem tratamento:", reason);
});

app.disable("x-powered-by");

// ─── Variáveis disponíveis em todas as views ────────────────────────────────
// Versão dos CSS/JS, usada pelo layout para montar /css/main.css?v=...
app.locals.assetVersion = assetVersion;
app.locals.catLabel = catLabel;
app.locals.catCls = catCls;

// Datas sempre no horário de Brasília, independentemente do fuso do servidor.
const TIME_ZONE = "America/Sao_Paulo";
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
app.locals.fmtDate = (value) => (value ? dateFormat.format(new Date(value)) : "");
app.locals.fmtDateTime = (value) => (value ? `${dateFormat.format(new Date(value))} ${timeFormat.format(new Date(value))}` : "");
// plural(1, "resposta", "respostas") -> "resposta"
app.locals.plural = (count, one, many) => (Number(count) === 1 ? one : many);

// ─── Variáveis de ambiente obrigatórias ─────────────────────────────────────
// Como MONGODB_URI (ver config/db.js), o SESSION_SECRET precisa ser definido
// explicitamente; o servidor não sobe com um valor padrão fixo no código.
if (!process.env.SESSION_SECRET) {
  console.error(
    "❌ SESSION_SECRET não foi definida no .env. Gere uma com:\n" +
      '   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
  process.exit(1);
}

// ─── Conexão com o banco ────────────────────────────────────────────────────
connectDB();

// ─── View engine ─────────────────────────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// Em produção o app roda atrás de um proxy reverso que faz a terminação HTTPS
// (Render, Railway, Nginx etc.). `trust proxy` faz o Express reconhecer a
// conexão como segura (cookie "secure") e usar o IP real do visitante em
// req.ip, que o limite de tentativas usa. O valor 1 considera um único proxy;
// ajuste se a hospedagem tiver mais camadas na frente.
if (isProduction) {
  app.set("trust proxy", 1);
}

// ─── Healthcheck (usado pelo self-ping) ──────────────────────────────────────
// Fica antes de sessão e CSRF para não consultar o MongoDB nem gerar cookies.
app.get("/healthcheck", (req, res) => {
  res.status(200).send("OK");
});

// ─── Compressão (opcional) ───────────────────────────────────────────────────
// Reduz o tamanho de HTML, CSS e JS. É ativada automaticamente quando o pacote
// "compression" está instalado (`npm install compression`).
try {
  app.use(require("compression")());
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") throw err;
}

// ─── Cabeçalhos de segurança básicos ─────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ─── Arquivos estáticos ──────────────────────────────────────────────────────
// Ficam antes dos parsers, da sessão e do CSRF: um pedido de CSS/JS não precisa
// passar por nada disso. Em produção o navegador guarda os arquivos por 30
// dias; como o layout usa URLs versionadas (?v=hash), uma nova versão do site
// nunca fica presa no cache.
app.use(
  express.static(path.join(__dirname, "public"), isProduction ? { maxAge: "30d", immutable: true } : {})
);
// Navegadores pedem /favicon.ico por conta própria; responder aqui evita passar
// por sessão e banco só para terminar numa página 404.
app.get("/favicon.ico", (req, res) => res.status(204).end());

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride("_method"));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // touchAfter: renova a validade da sessão no máximo 1x por dia, em vez de
    // gravar no MongoDB a cada requisição.
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI, touchAfter: 24 * 3600 }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    },
  })
);

app.use(attachUser);

// ─── Proteção CSRF ───────────────────────────────────────────────────────────
// attachCsrfToken gera o token em toda resposta (os formulários da página
// precisam dele, inclusive em GET); doubleCsrfProtection valida o token em toda
// requisição que muda estado (POST/PUT/PATCH/DELETE).
app.use(attachCsrfToken);
app.use(doubleCsrfProtection);

// Disponibiliza icon() e o caminho atual (usado para marcar o item ativo do
// menu) em todas as views.
app.use((req, res, next) => {
  res.locals.icon = icon;
  res.locals.currentPath = req.path;
  next();
});

// ─── Rotas ───────────────────────────────────────────────────────────────────
app.use("/", authRoutes);
app.use("/", mainRoutes);
app.use("/", pageRoutes);
app.use("/", profileRoutes);
app.use("/", notificationRoutes);
app.use("/admin", adminRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render("404", { title: "Página não encontrada" });
});

// ─── Handler de erro global ──────────────────────────────────────────────────
// Recebe qualquer erro não tratado de uma rota (síncrono ou passado via
// next(err)), para não travar a requisição nem expor detalhes internos ao
// navegador. As rotas continuam tratando os próprios erros previsíveis.
app.use((err, req, res, next) => {
  if (err === invalidCsrfTokenError || err?.code === "EBADCSRFTOKEN") {
    console.warn(`Token CSRF inválido/ausente em ${req.method} ${req.originalUrl}`);
    return res.status(403).render("403", {
      title: "Sessão expirada",
      heading: "Sessão expirada",
      message: "Sua sessão de formulário expirou ou é inválida. Atualize a página e tente novamente.",
    });
  }
  console.error("Erro não tratado:", err);
  if (res.headersSent) return next(err);
  res.status(500).render("500", { title: "Erro" });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);

  // ─── Self-ping: evita o spin-down do plano gratuito do Render ──────────────
  // O Render define RENDER_EXTERNAL_URL automaticamente; APP_URL é o fallback.
  const PING_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  const PING_INTERVAL = 12 * 60 * 1000; // 12 minutos

  if (isProduction && PING_URL) {
    setInterval(async () => {
      try {
        const res = await fetch(`${PING_URL}/healthcheck`, {
          signal: AbortSignal.timeout(10000), // desiste após 10s
        });
        console.log(`✅ Self-ping OK (${res.status}) - ${new Date().toISOString()}`);
      } catch (err) {
        console.error(`❌ Self-ping falhou: ${err.message}`);
      }
    }, PING_INTERVAL);
  }
});

// Ao receber o sinal de encerramento (deploy/reinício), termina as requisições
// em andamento e fecha a conexão com o banco antes de sair.
function shutdown(signal) {
  console.log(`Recebido ${signal}, encerrando...`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
    } finally {
      process.exit(0);
    }
  });
  // Se algo ficar preso, não espera para sempre.
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
