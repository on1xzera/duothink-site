# DuoThink

Site em português com HTML, CSS, JavaScript e WebGL, sem dependências de produção. Todas as imagens, fontes e efeitos são locais.

## Executar

Com Node.js 22 ou superior:

```bash
npm start
```

Abra http://localhost:3000. Não é necessário executar `npm install`. O projeto também funciona com Live Server no VS Code; abra `dtk-website.code-workspace` e inicie o `index.html` pelo servidor.

## Publicação

```bash
npm run build
npm run preview
```

O build cria `dist/` e versões Brotli/gzip dos arquivos de texto. Publique o conteúdo de `dist/` em hospedagem estática, ou use o servidor Node.js incluído. O envio automático do formulário precisa da API.

## Formulário

Copie `.env.example` para `.env` e preencha `RESEND_API_KEY`, `CONTACT_FROM_EMAIL` e `CONTACT_TO_EMAIL`. Use um remetente autorizado no Resend e reinicie o servidor. Na Vercel, mantenha `api/contact.js`, `server/contact.js` e as variáveis do provedor.

Sem configuração de envio, o formulário oferece abrir o aplicativo de e-mail com a mensagem preenchida e informa essa condição. Credenciais ficam apenas no servidor.

## Arquivos

- `index.html`, `about/`, `contact/`, `projects/`, `legal/`, `404/`: páginas.
- `assets/images/`, `assets/fonts/`: imagens e fontes locais.
- `assets/styles/`: estilos compartilhados e por página.
- `assets/scripts/`, `assets/shaders/`: interações e efeitos gráficos.
- `api/`, `server/`: formulário de contato.
- `tools/`, `tests/`: servidor, build e verificações.

## Recursos e desempenho

As mídias são imagens estáticas com carregamento adiado e dimensões declaradas. O case Paulo Padilha usa arquivos principais WebP sem perda de compressão e variantes menores para telas menores, com proporções preservadas. Os serviços usam imagens WebP na resolução original, com artes distintas por espaço e um único card por serviço em todos os tamanhos de tela. As imagens do processo mantêm a abertura interativa da pasta.

Scroll suave, entradas de texto, hovers, carrossel, isotipos 3D, ondas e gradientes continuam ativos. Os efeitos pausam fora da tela ou em abas ocultas e respeitam movimento reduzido. Gradientes e ondas usam superfícies menores, e a simulação das ondas compartilha a mesma resolução entre o código e o shader; o texto da rolagem atualiza somente os caracteres cuja cor muda.

Para invalidar o cache em uma nova entrega, altere `version` no `package.json` e execute `npm run assets:version`.

## Verificar

```bash
npm run check
npm test
```

O check valida páginas, módulos, URLs de imagens responsivas e referências locais. Os testes verificam as rotas, proteção do servidor, formulário e respostas HTTP. Para verificações opcionais de navegador no computador de desenvolvimento:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
npm run test:isotype
```

## Fontes

Switzer: Indian Type Foundry / Fontshare, conforme seus termos de distribuição. Inter e Anton: SIL Open Font License 1.1. Os avisos estão em `assets/fonts/licenses/`.
