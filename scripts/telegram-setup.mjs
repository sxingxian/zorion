// Points Zorion's Telegram bot at the app and sets its commands straight away. Optional: the app's hourly
// job does the same by itself once TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are set.
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... APP_ORIGIN=https://zorionapp.midnightpoetry.studio npm run telegram:setup
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, APP_ORIGIN: origin } = process.env;
if (!token || !secret || !origin) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_ORIGIN.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
  console.error('TELEGRAM_WEBHOOK_SECRET must be 16 to 256 characters of A-Z, a-z, 0-9, _ and -. Try: openssl rand -hex 32');
  process.exit(1);
}
if (!origin.startsWith('https://')) {
  console.error('APP_ORIGIN must be the https address of the app.');
  process.exit(1);
}
const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
};
await call('setWebhook', { url: `${origin}/api/webhooks/telegram`, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
await call('setMyCommands', { commands: [{ command: 'stop', description: 'Stop all messages from Zorion' }] });
await call('setMyDescription', { description: 'Zorion messages you about meetups you connected: when votes are in, the date is set, and where to go. Connect from a meetup page or your Zorion account. Send /stop to stop.' });
const me = await call('getMe', {});
console.log(`Telegram is ready: @${me.username} sends updates, and updates arrive at ${origin}/api/webhooks/telegram`);
console.log(`Set TELEGRAM_BOT_USERNAME to ${me.username} if you have not.`);
