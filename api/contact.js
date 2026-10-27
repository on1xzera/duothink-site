import { sendInquiry, validateInquiry } from '../server/contact.js';

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS = 6;

/** Same handler for the local Node server and serverless hosting. */
export default async function contactHandler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  const reply = (status, body) => {
    response.statusCode = status;
    response.end(JSON.stringify(body));
  };
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    reply(405, { message: 'Método não permitido.' });
    return;
  }
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        reply(403, { message: 'A solicitação deve ser enviada por este site.' });
        return;
      }
    } catch {
      reply(403, { message: 'Origem inválida.' });
      return;
    }
  }
  const now = Date.now();
  for (const [key, attempt] of attempts) if (now - attempt.start > WINDOW_MS) attempts.delete(key);
  const address =
    request.socket?.remoteAddress ||
    request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown';
  const attempt = attempts.get(address) || { count: 0, start: now };
  if (attempt.count >= MAX_ATTEMPTS) {
    reply(429, { message: 'Muitos pedidos. Tente mais tarde ou fale conosco por email.' });
    return;
  }
  attempt.count += 1;
  attempts.set(address, attempt);
  if (!String(request.headers['content-type'] || '').includes('application/json')) {
    reply(415, { message: 'Envie dados em JSON.' });
    return;
  }
  try {
    let input = request.body;
    if (!input) {
      const buffers = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 12_000) {
          reply(413, { message: 'O pedido é muito longo.' });
          return;
        }
        buffers.push(chunk);
      }
      input = JSON.parse(Buffer.concat(buffers).toString('utf8'));
    } else if (typeof input === 'string') {
      if (Buffer.byteLength(input) > 12_000) {
        reply(413, { message: 'O pedido é muito longo.' });
        return;
      }
      input = JSON.parse(input);
    }
    const validation = validateInquiry(input);
    if (validation.error) {
      reply(400, { message: validation.error });
      return;
    }
    const result = await sendInquiry(validation.fields);
    reply(result.status, result.body);
  } catch (error) {
    reply(error instanceof SyntaxError ? 400 : 502, {
      message:
        error instanceof SyntaxError
          ? 'JSON inválido.'
          : 'Não foi possível enviar. Tente novamente ou fale conosco por email.',
    });
  }
}
