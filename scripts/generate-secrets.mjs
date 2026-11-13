// Makes the random secrets Zorion needs and prints them once. Nothing is written to disk.
// Prefer the "Create Worker secrets" GitHub workflow, which saves them into Cloudflare without showing them.
//   node scripts/generate-secrets.mjs
import { randomBytes } from 'node:crypto';

const hex = (n) => randomBytes(n).toString('hex');
console.log(`# Same value on zorion-app and zorion-site. Never change them once people use Zorion.
PEPPER=${hex(32)}
TOTP_KEY=${randomBytes(32).toString('base64')}

# zorion-app, only if you set up Telegram
TELEGRAM_WEBHOOK_SECRET=${hex(32)}

# zorion-site, only while you create the first admin; delete it afterwards
ADMIN_SETUP_TOKEN=${hex(24)}`);
