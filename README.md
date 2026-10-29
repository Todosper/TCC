# Fórum / FAQ — IFSul Campus Bagé

Sistema web de fórum de discussões, perguntas frequentes (FAQ) e sugestões para a comunidade do IFSul Campus Bagé.

**Tecnologias:** Node.js, Express 4, EJS, MongoDB (Mongoose), Firebase Authentication (e-mail de confirmação e redefinição de senha).

## Variáveis de ambiente

Todas estão descritas em `.env.example`. As principais: `MONGODB_URI`, `SESSION_SECRET`, `FIREBASE_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `ALLOWED_EMAIL_DOMAINS` e, para o login com o Google, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

Para ativar a compressão das respostas, instale o pacote opcional: `npm install compression`.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `routes/` | Rotas: autenticação, fórum/FAQ/sugestões, perfil, notificações, páginas informativas e painel admin |
| `models/` | Modelos do MongoDB |
| `middleware/` | Autenticação, CSRF, limite de tentativas |
| `helpers/` | Utilitários (e-mail, busca, paginação, Firebase, notificações...) |
| `views/` | Páginas EJS (`partials/` guarda os trechos reutilizados) |
| `public/` | CSS e JavaScript do navegador |

## Acessibilidade

O painel "Acessibilidade" (tema, tamanho do texto, contraste, destaque de links e botão de Libras) funciona em todas as páginas, e a página `/acessibilidade` descreve os recursos. O primeiro `Tab` em qualquer página leva ao link "Ir para o conteúdo".
