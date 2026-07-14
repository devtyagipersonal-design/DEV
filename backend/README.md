# Telegram Wallet Backend

Koyeb pe deploy karne ke liye Node.js backend.

## Setup

1. `.env.example` ko `.env` mein copy karo aur values bharo
2. `npm install`
3. `npm run dev` (local) ya `npm start` (production)

## Koyeb Deployment

1. Yeh code GitHub pe push karo (naya repo)
2. Koyeb dashboard → Create Service → GitHub → repo select karo
3. Environment variables set karo:
   - `TELEGRAM_BOT_TOKEN` — BotFather se
   - `MONGODB_URI` — MongoDB Atlas se
   - `PAYMENT_PROVIDER_TOKEN` — (optional, dollar payments ke liye, BotFather → Payments)
4. Deploy karo
5. Deploy hone ke baad `index.js` mein webhook URL uncomment karo:
   ```js
   bot.setWebHook(`https://your-app.koyeb.app/api/telegram-webhook`);
   ```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/deposit` | Create deposit invoice |
| POST | `/api/withdraw` | Process withdrawal |
| POST | `/api/balance` | Get user balance |
| POST | `/api/transactions` | Get transaction history |
| POST | `/api/telegram-webhook` | Telegram payment webhook |
| GET | `/` | Health check |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from BotFather |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `PAYMENT_PROVIDER_TOKEN` | ❌ | For $ payments (Stripe via BotFather) |
| `PORT` | ❌ | Server port (default: 8000) |
