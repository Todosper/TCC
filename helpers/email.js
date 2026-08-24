// [DESATIVADO] A integração com o Resend foi retirada porque não temos
// domínio próprio — sem um domínio verificado no painel do Resend, não é
// possível enviar e-mails para outras pessoas. Todo o código de envio ficou
// mantido neste arquivo (e nos demais, sempre marcado com "[DESATIVADO]")
// para ser reativado no futuro: descomente as linhas indicadas, configure
// RESEND_API_KEY/EMAIL_FROM no ambiente e religue os pontos de chamada em
// routes/auth.js.
//
// const { Resend } = require("resend");

// Sem RESEND_API_KEY configurada, o app continua funcionando normalmente —
// só não envia e-mails de verdade, e registra isso no log do servidor em vez
// de quebrar o cadastro/login/recuperação de senha de todo mundo. Isso
// importa especialmente durante o desenvolvimento local e antes de você
// configurar a variável em produção.
//
// [DESATIVADO] Com o cliente nulo, nenhuma função deste arquivo envia nada —
// todas caem no aviso de "não configurado" dentro de sendEmail().
const resend = null; // era: process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Remetente: enquanto nenhum domínio for verificado no Resend, SÓ é possível
// enviar para o e-mail da própria conta Resend, usando este remetente
// genérico de teste. Depois de verificar um domínio (ver painel do Resend),
// troque EMAIL_FROM para algo como "IFSul Fórum <naoresponda@seudominio.com>"
// via variável de ambiente — sem precisar mexer no código.
const FROM = process.env.EMAIL_FROM || "IFSul Fórum <onboarding@resend.dev>";

async function sendEmail({ to, subject, html, text }) {
  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY não configurada — e-mail para ${to} NÃO foi enviado (assunto: "${subject}"). ` +
        "Configure a variável de ambiente para ativar o envio real."
    );
    return { sent: false, reason: "not_configured" };
  }

  try {
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) {
      console.error("[email] Falha ao enviar via Resend:", error);
      return { sent: false, reason: "provider_error", error };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error("[email] Erro inesperado ao enviar e-mail:", err);
    return { sent: false, reason: "unexpected_error", error: err };
  }
}

function baseUrl() {
  // Em produção, defina APP_URL (ex.: https://seusite.onrender.com) para que
  // os links dos e-mails apontem para o domínio correto. Sem isso, cai num
  // fallback de desenvolvimento local.
  return process.env.APP_URL || "http://localhost:3000";
}

async function sendVerificationEmail(user, rawToken) {
  const link = `${baseUrl()}/verificar-email?token=${rawToken}&id=${user._id}`;
  return sendEmail({
    to: user.email,
    subject: "Confirme seu e-mail — IFSul Fórum",
    text: `Olá, ${user.name}! Confirme seu e-mail acessando: ${link} (válido por 24 horas). Se você não criou esta conta, ignore este e-mail.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2>Confirme seu e-mail</h2>
        <p>Olá, ${user.name}!</p>
        <p>Clique no botão abaixo para confirmar seu e-mail e ativar todos os recursos da sua conta no Fórum/FAQ do IFSul Bagé.</p>
        <p><a href="${link}" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Confirmar e-mail</a></p>
        <p style="color:#666;font-size:0.875rem;">Este link é válido por 24 horas. Se você não criou esta conta, pode ignorar este e-mail com segurança.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(user, rawToken) {
  const link = `${baseUrl()}/redefinir-senha?token=${rawToken}&id=${user._id}`;
  return sendEmail({
    to: user.email,
    subject: "Redefinição de senha — IFSul Fórum",
    text: `Olá, ${user.name}! Redefina sua senha acessando: ${link} (válido por 1 hora). Se você não pediu isso, ignore este e-mail — sua senha atual continua válida.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2>Redefinir senha</h2>
        <p>Olá, ${user.name}!</p>
        <p>Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova senha.</p>
        <p><a href="${link}" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Redefinir senha</a></p>
        <p style="color:#666;font-size:0.875rem;">Este link é válido por apenas 1 hora. Se você não pediu essa redefinição, ignore este e-mail — sua senha atual continua válida e nenhuma ação é necessária.</p>
      </div>
    `,
  });
}

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
