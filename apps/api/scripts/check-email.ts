/**
 * Checks an SMTP configuration before it goes anywhere near production.
 *
 * It builds the transport from exactly the variables the server reads, and in the same
 * shape `mail/transport.ts` builds them, so a pass here means the server will connect
 * too. Then it does the only thing that actually proves delivery: sends one real message
 * and waits for the server to accept it.
 *
 *   EMAIL_HOST      e.g. smtp-relay.brevo.com
 *   EMAIL_PORT      587 (STARTTLS) or 465 (TLS)
 *   EMAIL_SECURE    false for 587, true for 465
 *   EMAIL_USER      the SMTP login
 *   EMAIL_PASSWORD  the SMTP key — never printed by this script
 *   EMAIL_FROM      e.g. "Ekavist <no-reply@ekavex.in>"
 *   EMAIL_TO        where to send the test message
 *
 *   npx tsx apps/api/scripts/check-email.ts
 *
 * Nothing is written to the database and no application code is started, so it is safe to
 * run against production credentials from a laptop.
 */
import nodemailer from 'nodemailer';

function required(name: string): string {
  const value = process.env[name];
  if (value == null || value.trim() === '') {
    throw new Error(`${name} is not set. See the comment at the top of this script.`);
  }
  return value;
}

const host = required('EMAIL_HOST');
const port = Number(required('EMAIL_PORT'));
const secure = (process.env['EMAIL_SECURE'] ?? 'false').toLowerCase() === 'true';
const user = process.env['EMAIL_USER'];
const from = required('EMAIL_FROM');
const to = required('EMAIL_TO');

// The commonest configuration error, and it presents as a hang rather than an error.
if ((port === 465 && !secure) || (port === 587 && secure)) {
  console.warn(
    `Warning: port ${port} with EMAIL_SECURE=${secure} is usually wrong. ` +
      'Use 587 with false (STARTTLS), or 465 with true (TLS from the first byte).\n',
  );
}

console.log(`Host   : ${host}:${port} (secure=${secure})`);
console.log(`User   : ${user ?? '(none — unauthenticated)'}`);
console.log(`From   : ${from}`);
console.log(`To     : ${to}\n`);

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  ...(user ? { auth: { user, pass: process.env['EMAIL_PASSWORD'] ?? '' } } : {}),
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
});

try {
  process.stdout.write('1. Connecting and authenticating… ');
  await transporter.verify();
  console.log('ok');

  process.stdout.write('2. Sending a test message… ');
  const info = await transporter.sendMail({
    from,
    to,
    subject: 'Ekavist SMTP check',
    text:
      'If you are reading this, Ekavist can send email with these settings.\n\n' +
      `Sent ${new Date().toISOString()} by apps/api/scripts/check-email.ts.`,
  });
  console.log('accepted');

  console.log(`\n   message id : ${info.messageId}`);
  console.log(`   accepted   : ${JSON.stringify(info.accepted)}`);
  if (info.rejected.length > 0) console.log(`   rejected   : ${JSON.stringify(info.rejected)}`);
  console.log(`   response   : ${info.response}`);
  console.log('\nThe server accepted the message. Check the inbox — including spam.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log('FAILED\n');
  console.error(message);

  // The four failures worth naming, because the raw message rarely says what to change.
  if (/EAUTH|535|Invalid login/i.test(message)) {
    console.error(
      '\nAuthentication was refused. EMAIL_USER must be the provider SMTP login and ' +
        'EMAIL_PASSWORD the SMTP key — not your account password.',
    );
  } else if (/ETIMEDOUT|ECONNREFUSED|greeting/i.test(message)) {
    console.error(
      `\nCould not reach ${host}:${port}. Check the port, and check EMAIL_SECURE: ` +
        '587 needs false, 465 needs true. A mismatch looks exactly like this.',
    );
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    console.error(`\n${host} did not resolve. Check EMAIL_HOST for a typo.`);
  } else if (/550|553|not verified|domain/i.test(message)) {
    console.error(
      '\nThe sender was rejected. Most providers require the EMAIL_FROM domain to be ' +
        'verified before they will send from it.',
    );
  }
  process.exitCode = 1;
} finally {
  transporter.close();
}
