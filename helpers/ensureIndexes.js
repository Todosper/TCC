// Ajustes de índices que o Mongoose não consegue fazer sozinho em um banco que
// já existe. Roda uma vez, logo depois da conexão (ver config/db.js).
const Report = require("../models/Report");

const REPORT_UNIQUE_KEY = { reporter: 1, topic: 1, comment: 1 };
const NAMESPACE_NOT_FOUND = 26;

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Mantém só a denúncia mais antiga de cada (denunciante, tópico, comentário) e
// apaga as repetidas. Sem isso, o MongoDB recusa criar o índice único.
async function removeDuplicateReports() {
  const groups = await Report.aggregate(
    [
      { $sort: { createdAt: 1, _id: 1 } },
      { $group: { _id: { reporter: "$reporter", topic: "$topic", comment: "$comment" }, ids: { $push: "$_id" } } },
      { $match: { "ids.1": { $exists: true } } },
    ],
    { allowDiskUse: true }
  );
  const extra = groups.flatMap((g) => g.ids.slice(1));
  if (extra.length > 0) await Report.deleteMany({ _id: { $in: extra } });
  return extra.length;
}

// Garante o índice ÚNICO (reporter, topic, comment) em denúncias. Se já existir
// um índice com as mesmas chaves, mas sem a regra de unicidade (o que o site
// criava antes), ele é trocado pelo único.
async function ensureReportUniqueIndex() {
  const collection = Report.collection;

  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (err) {
    if (err.code !== NAMESPACE_NOT_FOUND) throw err; // coleção ainda não existe
  }

  const current = indexes.find((index) => sameKey(index.key, REPORT_UNIQUE_KEY));
  if (current && current.unique) return;

  const removed = await removeDuplicateReports();
  if (removed > 0) console.log(`🧹 ${removed} denúncia(s) repetida(s) removida(s) (mantida a mais antiga de cada grupo).`);

  if (current) await collection.dropIndex(current.name);
  await collection.createIndex(REPORT_UNIQUE_KEY, { unique: true });
  console.log("✅ Índice único de denúncias criado.");
}

// Nunca derruba o site: se algo falhar, a checagem feita no código (rota de
// denúncia) continua evitando duplicatas na maioria dos casos.
async function ensureIndexes() {
  try {
    await ensureReportUniqueIndex();
  } catch (err) {
    console.error("⚠️  Não foi possível garantir o índice único de denúncias:", err.message);
  }
}

module.exports = { ensureIndexes };
