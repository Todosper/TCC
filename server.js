require("dotenv").config();
const express = require("express");
const path = require("path");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const methodOverride = require("method-override");

const connectDB = require("./config/db");
const { attachUser } = require("./middleware/auth");
const icon = require("./config/icons");

const authRoutes = require("./routes/auth");
const mainRoutes = require("./routes/main");
const profileRoutes = require("./routes/profile");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Conexão com o banco ────────────────────────────────────────────────────
connectDB();

// ─── View engine ─────────────────────────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "segredo_padrao_troque_isso",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 dias
  })
);

app.use(attachUser);

// Disponibiliza a função icon() em todas as views EJS
app.use((req, res, next) => {
  res.locals.icon = icon;
  next();
});

// ─── Rotas ───────────────────────────────────────────────────────────────────
app.use("/", authRoutes);
app.use("/", mainRoutes);
app.use("/", profileRoutes);
app.use("/admin", adminRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render("404", { title: "Página não encontrada" });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
