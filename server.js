require("dotenv").config();
const express = require("express");
const path = require("path");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const methodOverride = require("method-override");
const cookieParser = require("cookie-parser");

const connectDB = require("./config/db");
const { attachUser } = require("./middleware/auth");
const icon = require("./config/icons");
const { doubleCsrfProtection, attachCsrfToken, invalidCsrfTokenError } = require("./middleware/csrf");

const authRoutes = require("./routes/auth");
const mainRoutes = require("./routes/main");
const profileRoutes = require("./routes/profile");
const adminRoutes = require("./routes/admin");
const notificationRoutes = require("./routes/notifications");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Variáveis de ambiente obrigatórias ─────────────────────────────────────
// Assim como já acontece para MONGODB_URI (ver config/db.js), o servidor não
// deve subir sem um SESSION_SECRET forte definido explicitamente — nunca usar
// um valor padrão fixo no código-fonte para isso.
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

// Em produção, o app normalmente roda atrás de um proxy reverso que faz a
// terminação HTTPS (ex.: Render, Railway, Nginx). Isso é necessário para que
// o Express reconheça corretamente a conexão como segura (cookie "secure") e
// para que req.ip reflita o IP real do visitante (usado no rate limiting).
// IMPORTANTE: ajuste esse valor conforme a plataforma de hospedagem escolhida
// caso o comportamento de req.ip não pareça correto em produção.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
// ─── Healthcheck (usado pelo self-ping) ──────────────────────────────────────
// Fica ANTES de sessão/CSRF de propósito: o ping não deve tocar no MongoDB
// nem gerar cookies.
app.get("/healthcheck", (req, res) => {
  res.status(200).send("OK");
});
// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

app.use(attachUser);

// ─── Proteção CSRF ───────────────────────────────────────────────────────────
// Precisa vir depois da sessão (usa req.session.id para amarrar o token) e
// antes das rotas. attachCsrfToken gera/renova o token em toda resposta
// (necessário até em GET, para que os formulários daquela página tenham o
// token mais recente); doubleCsrfProtection valida o token em toda requisição
// que muda estado (POST/PUT/PATCH/DELETE).
app.use(attachCsrfToken);
app.use(doubleCsrfProtection);

// Disponibiliza a função icon() em todas as views EJS
app.use((req, res, next) => {
  res.locals.icon = icon;
  next();
});

// ─── Rotas ───────────────────────────────────────────────────────────────────
app.use("/", authRoutes);
app.use("/", mainRoutes);
app.use("/", profileRoutes);
app.use("/", notificationRoutes);
app.use("/admin", adminRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render("404", { title: "Página não encontrada" });
});

// ─── Handler de erro global ──────────────────────────────────────────────────
// Rede de segurança final: qualquer erro não tratado em uma rota (síncrono ou
// passado explicitamente via next(err)) cai aqui em vez de travar a
// requisição ou vazar detalhes internos para o navegador. Cada rota continua
// devendo tratar seus próprios erros previsíveis (try/catch) — isto é só o
// último resort para o que passar despercebido.
app.use((err, req, res, next) => {
  if (err === invalidCsrfTokenError || err?.code === "EBADCSRFTOKEN") {
    console.warn(`Token CSRF inválido/ausente em ${req.method} ${req.originalUrl}`);
    return res.status(403).render("403", {
      title: "Sessão expirada",
      message: "Sua sessão de formulário expirou ou é inválida. Atualize a página e tente novamente.",
    });
  }
  console.error("Erro não tratado:", err);
  if (res.headersSent) return next(err);
  res.status(500).render("500", { title: "Erro" });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);

  // ─── Self-ping: evita o spin-down do plano gratuito do Render ──────────────
  // O Render define RENDER_EXTERNAL_URL automaticamente; APP_URL é o fallback.
  const PING_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  const PING_INTERVAL = 12 * 60 * 1000; // 12 minutos

  if (process.env.NODE_ENV === "production" && PING_URL) {
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