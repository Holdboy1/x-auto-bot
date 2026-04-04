# X Auto-Post Bot

Bot de autopost para X focado em crypto, web3 e tech.

Stack:
- Node.js + TypeScript
- Groq para gerar posts
- Google Trends + CoinGecko + feeds de noticias para contexto
- Twitter API v2 para publicar
- SQLite para historico e feedback loop
- Telegram opcional para dashboard
- Railway para deploy

## Requisitos

- Node.js 20+
- Conta no X Developer Portal
- `GROQ_API_KEY`
- Opcional: bot do Telegram

## Variaveis de ambiente

Copie `.env.example` para `.env` e preencha:

- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_SECRET`
- `GROQ_API_KEY`
- `GROQ_MODEL` opcional
- `TELEGRAM_BOT_TOKEN` opcional
- `TELEGRAM_CHAT_ID` opcional

## Rodando localmente

```powershell
npm install
npm run check
npm start
```

## Fluxo

1. Coleta topicos de varias fontes.
2. Gera posts com a Groq.
3. Agenda a publicacao dentro da janela configurada.
4. Reconsulta engajamento dos posts recentes.
5. Salva top performers para influenciar geracoes futuras.

## Cron padrao

- `07:00` pipeline diario
- `*/6h` coleta de engajamento
- `23:00` relatorio Telegram

## Deploy no Railway

1. Suba este projeto para o GitHub.
2. No Railway, crie um projeto a partir do repositorio.
3. Adicione as mesmas variaveis do `.env`.
4. Configure `RAILWAY_VOLUME_MOUNT_PATH=/data`.
5. Mantenha o processo como worker/servico sem porta publica.
