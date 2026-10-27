const SERVICES = new Set(['Sites', 'Plataformas internas', 'Aplicativos', 'SEO', 'Design de marca']);
const MAX_FIELD_LENGTH = 6_000;

export function validateInquiry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { error: 'Pedido inválido.' };
  const fields = {};
  for (const key of ['name', 'email', 'service', 'project']) {
    if (
      typeof input[key] !== 'string' ||
      !input[key].trim() ||
      input[key].length > MAX_FIELD_LENGTH
    )
      return { error: 'Preencha todos os campos com informações válidas.' };
    fields[key] = input[key].trim();
  }
  if (
    fields.name.length > 150 ||
    fields.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(fields.email) ||
    /[\r\n]/u.test(fields.email)
  )
    return { error: 'Informe um nome e um endereço de email válidos.' };
  if (!SERVICES.has(fields.service))
    return { error: 'Selecione um dos serviços disponíveis.' };
  return { fields };
}

export async function sendInquiry(fields, environment = process.env, transport = fetch) {
  if (
    !environment.RESEND_API_KEY ||
    !environment.CONTACT_FROM_EMAIL ||
    !environment.CONTACT_TO_EMAIL
  )
    return {
      status: 503,
      body: { composeEmail: true, message: 'O envio automático de email não foi configurado.' },
    };
  const response = await transport('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${environment.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: environment.CONTACT_FROM_EMAIL,
      to: [environment.CONTACT_TO_EMAIL],
      reply_to: fields.email,
      subject: `Novo projeto: ${fields.service}`,
      text: `Nome: ${fields.name}\nEmail: ${fields.email}\nServiço: ${fields.service}\n\n${fields.project}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    return {
      status: 502,
      body: { message: 'Não foi possível enviar. Tente novamente ou fale conosco por email.' },
    };
  return { status: 200, body: { ok: true } };
}
