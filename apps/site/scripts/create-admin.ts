// Creates (or resets) an admin. Admins always sign in with password plus authenticator.
// Usage, from apps/site:
//   DATABASE_URL=... PEPPER=... TOTP_KEY=... npm run create-admin -- you@example.com super
import { neon } from '@neondatabase/serverless';
import { hashPassword, newTotpSecret, otpauthUri, randomToken, seal } from '../../../packages/server/src/crypto.ts';

const [email, role = 'support'] = process.argv.slice(2);
const { DATABASE_URL, PEPPER, TOTP_KEY } = process.env;
if (!email || !/^\S+@\S+\.\S+$/.test(email) || !['super', 'support'].includes(role) || !DATABASE_URL || !PEPPER || !TOTP_KEY) {
  console.error('Usage: DATABASE_URL=... PEPPER=... TOTP_KEY=... npm run create-admin -- email@example.com [super|support]');
  process.exit(1);
}
const password = process.env.ADMIN_PASSWORD ?? randomToken(18);
const secret = newTotpSecret();
const sql = neon(DATABASE_URL);
await sql.query(
  `insert into admins (email, password_hash, totp_secret, totp_enabled, role) values ($1, $2, $3, true, $4)
   on conflict (email) do update set password_hash = excluded.password_hash, totp_secret = excluded.totp_secret, totp_enabled = true, totp_last_step = 0, role = excluded.role, active = true`,
  [email.toLowerCase(), await hashPassword(password, PEPPER), await seal(secret, TOTP_KEY), role],
);
console.log(`Admin ready: ${email.toLowerCase()} (${role})`);
if (!process.env.ADMIN_PASSWORD) console.log(`Password (shown once): ${password}`);
console.log(`Authenticator key: ${secret}`);
console.log(`Or open: ${otpauthUri(secret, email.toLowerCase(), 'Zorion Admin')}`);
