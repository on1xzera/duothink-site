export function initializeContactForm() {
  document.querySelectorAll('[data-contact-form]').forEach((form) => {
    const button = form.querySelector('[type="submit"]');
    const label = button.querySelector('p') || button;
    const status = form.querySelector('.form-status');
    let sending = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (sending || !form.reportValidity()) return;
      sending = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      label.textContent = 'Enviando…';
      status.replaceChildren();
      const fields = Object.fromEntries(new FormData(form));
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fields),
          signal: AbortSignal.timeout(20_000),
        });
        const result = await response.json().catch(() => ({}));
        const jsonResponse = response.headers.get('content-type')?.includes('application/json');
        if (
          !jsonResponse ||
          response.status === 404 ||
          (response.status === 503 && result.composeEmail)
        ) {
          const subject = `Novo projeto: ${fields.service}`;
          const body = `Nome: ${fields.name}\nEmail: ${fields.email}\nServiço: ${fields.service}\n\n${fields.project}`;
          const link = document.createElement('a');
          link.href = `mailto:hello@emberagency.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          link.textContent = 'Abra seu email para enviar esta mensagem.';
          status.append('O envio automático ainda não foi configurado. ', link);
        } else if (!response.ok) {
          throw new Error(
            result.message ||
              'Não foi possível enviar. Tente novamente ou fale conosco por email.',
          );
        } else {
          form.reset();
          status.textContent = 'Obrigado! Sua mensagem foi enviada.';
        }
      } catch (error) {
        status.textContent =
          error.name === 'TimeoutError'
            ? 'O tempo esgotou. Tente novamente ou envie para hello@emberagency.com.'
            : error.message;
      } finally {
        sending = false;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        label.textContent = 'Enviar';
      }
    });
  });
}
