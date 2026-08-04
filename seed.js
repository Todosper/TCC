// Script para popular o banco.
// Rode com: node seed.js
// ATENÇÃO: isso apaga as coleções existentes antes de inserir os dados novos.

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./config/db");

const User = require("./models/User");
const Topic = require("./models/Topic");
const Comment = require("./models/Comment");
const FaqCategory = require("./models/FaqCategory");
const Faq = require("./models/Faq");

async function seed() {
  await connectDB();

  console.log("Limpando coleções...");
  await Promise.all([
    User.deleteMany({}),
    Topic.deleteMany({}),
    Comment.deleteMany({}),
    FaqCategory.deleteMany({}),
    Faq.deleteMany({}),
  ]);

  console.log("Criando usuários...");
  const users = await User.create([
    { name: "Maria Silva", email: "maria.silva@aluno.ifsul.edu.br", login: "maria.silva", password: "senha123", role: "estudante", status: "ativo" },
    { name: "João Pereira", email: "joao.pereira@aluno.ifsul.edu.br", login: "joao.pereira", password: "senha123", role: "estudante", status: "ativo" },
    { name: "Prof. Carlos Andrade", email: "carlos.andrade@ifsul.edu.br", login: "carlos.andrade", password: "senha123", role: "professor", status: "ativo" },
    { name: "Lucas Ferreira", email: "lucas.ferreira@aluno.ifsul.edu.br", login: "lucas.ferreira", password: "senha123", role: "estudante", status: "bloqueado" },
    { name: "Prof. Ana Lima", email: "ana.lima@ifsul.edu.br", login: "ana.lima", password: "senha123", role: "professor", status: "ativo" },
    { name: "Coordenação Acadêmica", email: "coordenacao@ifsul.edu.br", login: "coordenacao", password: "senha123", role: "staff", status: "ativo" },
    { name: "Admin", email: "admin@ifsul.edu.br", login: "admin", password: "admin123", role: "staff", status: "ativo", isAdmin: true },
  ]);

  const [maria, joao, carlos, lucas, ana, coord, admin] = users;

  console.log("Criando tópicos...");
  const topicsData = [
    { title: "Como me matricular em disciplinas optativas?", category: "matricula", author: maria, content: "Olá, gostaria de saber o processo para me matricular em disciplinas optativas neste semestre. Preciso fazer pelo SIGAA ou há outro procedimento?", tags: ["matrícula", "optativas", "SIGAA"], views: 43, locked: false },
    { title: "Laboratório de informática — disponível aos sábados?", category: "infraestrutura", author: joao, content: "Preciso saber se o laboratório fica aberto aos sábados para uso dos alunos.", tags: ["laboratório", "horários"], views: 22, locked: false },
    { title: "Prazos para entrega do TCC — Turma 2024/2", category: "academico", author: carlos, content: "Informo que os prazos para entrega do TCC da turma 2024/2 foram atualizados. Verifique o Calendário Acadêmico no portal.", tags: ["TCC", "prazos", "acadêmico"], views: 98, locked: false },
    { title: "Cardápio do Restaurante Universitário — semana 23", category: "servicos", author: coord, content: "Segue o cardápio do RU para esta semana. Segunda: feijão tropeiro. Terça: frango grelhado. Quarta: peixe assado.", tags: ["RU", "alimentação", "cardápio"], views: 67, locked: false },
    { title: "Abertura de vagas — bolsa de iniciação científica", category: "bolsas", author: coord, content: "Estão abertas as inscrições para bolsas de Iniciação Científica. Prazo para inscrição: 30/06/2025.", tags: ["bolsa", "IC", "pesquisa"], views: 134, locked: false },
    { title: "Problema de acesso ao SIGAA — tópico encerrado", category: "ti", author: lucas, content: "Relatei o problema de acesso ao SIGAA. O suporte de TI já resolveu o incidente.", tags: ["SIGAA", "acesso", "TI"], views: 55, locked: true },
  ];

  const topics = [];
  for (const t of topicsData) {
    const topic = await Topic.create({
      title: t.title,
      category: t.category,
      content: t.content,
      tags: t.tags,
      author: t.author._id,
      authorName: t.author.name,
      views: t.views,
      locked: t.locked,
    });
    topics.push(topic);
  }

  console.log("Criando comentários no primeiro tópico...");
  await Comment.create([
    { topic: topics[0]._id, author: ana._id, authorName: ana.name, authorRole: "Professora", text: "Olá Maria! Para se matricular em optativas, acesse o SIGAA com seu login e senha. Vá em Ensino → Matrícula → Solicitar Matrícula em Componente Curricular. O período geralmente ocorre após a matrícula regular." },
    { topic: topics[0]._id, author: maria._id, authorName: maria.name, authorRole: "Estudante", text: "Muito obrigada, Professora Ana! Consegui encontrar a opção. Mas há um limite de optativas por semestre?" },
    { topic: topics[0]._id, author: coord._id, authorName: "Coordenação Acadêmica", authorRole: "Staff", text: "O limite é de 2 disciplinas optativas por semestre, conforme o Regulamento Didático. Verifique também os pré-requisitos antes de solicitar." },
  ]);

  console.log("Criando categorias de FAQ...");
  const faqCats = await FaqCategory.create([
    { name: "Matrícula e Registro", icon: "FileText", cls: "faqcat-emerald" },
    { name: "Acadêmico e Curricular", icon: "BookOpen", cls: "faqcat-blue" },
    { name: "Bolsas e Auxílios", icon: "Award", cls: "faqcat-purple" },
    { name: "Infraestrutura e TI", icon: "Monitor", cls: "faqcat-amber" },
    { name: "Serviços e RU", icon: "Users", cls: "faqcat-orange" },
    { name: "Estágio e Emprego", icon: "Briefcase", cls: "faqcat-red" },
  ]);
  const [catMatricula, catAcademico, catBolsas, catInfra, catServicos, catEstagio] = faqCats;

  console.log("Criando perguntas frequentes...");
  await Faq.create([
    { question: "Como faço para renovar minha matrícula?", answer: "A renovação é realizada pelo SIGAA durante o período do Calendário Acadêmico. Acesse Ensino → Matrícula → Renovar Matrícula e selecione as disciplinas desejadas.", category: catMatricula._id },
    { question: "Posso trancar o semestre? Como funciona?", answer: "Sim, é possível trancar o semestre por até 2 anos consecutivos. Acesse o SIGAA no período de trancamento e solicite o trancamento de matrícula dentro do prazo.", category: catMatricula._id },
    { question: "Como solicitar aproveitamento de estudos?", answer: "Dirija-se à Coordenação do Curso com histórico escolar e ementas das disciplinas cursadas na instituição anterior. A análise é feita pela Coordenação e pelo professor responsável.", category: catAcademico._id },
    { question: "Qual é o índice mínimo de frequência para aprovação?", answer: "O mínimo é 75% das aulas ministradas em cada disciplina, conforme a LDB. A frequência é registrada pelo professor no SIGAA.", category: catAcademico._id },
    { question: "Quais bolsas estão disponíveis para estudantes?", answer: "O IFSul Bagé oferece: PNAES (assistência estudantil), Iniciação Científica (PIBIC/PIBITI), Monitoria, Extensão e PIBID. Inscrições via editais no portal.", category: catBolsas._id },
    { question: "Como acesso o Wi-Fi da instituição?", answer: "Conecte-se à rede 'IFSul-Aluno' e faça login com seu CPF e senha do SIGAA. Em caso de problemas, contate a TI pelo ramal 220.", category: catInfra._id },
    { question: "Esqueci minha senha do SIGAA, o que faço?", answer: "Acesse o portal SIGAA e clique em 'Esqueci minha senha'. Informe seu CPF e siga as instruções enviadas ao e-mail institucional. Sem acesso ao e-mail, dirija-se à Secretaria.", category: catInfra._id },
    { question: "Quais são os horários do Restaurante Universitário?", answer: "Segunda a sexta: Almoço das 11h30 às 13h30 e Jantar das 18h00 às 19h30. Fins de semana e feriados sem funcionamento.", category: catServicos._id },
    { question: "Como encontro vagas de estágio?", answer: "Vagas são divulgadas pelo Departamento de Estágios e pela plataforma CIEE. Acesse a seção Estágios no portal ou visite a Coordenação pessoalmente.", category: catEstagio._id },
  ]);

  console.log("✅ Seed concluído com sucesso!");
  console.log("");
  console.log("Login de administrador para teste:");
  console.log("  E-mail/login: admin  (ou admin@ifsul.edu.br)");
  console.log("  Senha: admin123");
  console.log("");
  console.log("Login de estudante para teste:");
  console.log("  E-mail/login: maria.silva  (ou maria.silva@aluno.ifsul.edu.br)");
  console.log("  Senha: senha123");

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Erro ao popular o banco:", err);
  process.exit(1);
});
