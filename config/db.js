const mongoose = require("mongoose");

async function connectDB() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI não foi definida no arquivo .env");
    }
    await mongoose.connect(uri);
    console.log("✅ Conectado ao MongoDB com sucesso.");
  } catch (err) {
    console.error("❌ Erro ao conectar ao MongoDB:", err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
