// Categorias do Fórum — fixas no sistema (não precisam de coleção própria,
// mas centralizamos aqui para reuso em todas as views e rotas).

const CATEGORIES = [
  { id: "academico", label: "Acadêmico", cls: "badge-blue" },
  { id: "matricula", label: "Matrícula", cls: "badge-emerald" },
  { id: "infraestrutura", label: "Infraestrutura", cls: "badge-amber" },
  { id: "bolsas", label: "Bolsas e Auxílios", cls: "badge-purple" },
  { id: "servicos", label: "Serviços", cls: "badge-orange" },
  { id: "ti", label: "TI e Sistemas", cls: "badge-red" },
];

function catLabel(id) {
  const found = CATEGORIES.find((c) => c.id === id);
  return found ? found.label : id;
}

function catCls(id) {
  const found = CATEGORIES.find((c) => c.id === id);
  return found ? found.cls : "badge-gray";
}

module.exports = { CATEGORIES, catLabel, catCls };
