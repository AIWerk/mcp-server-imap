import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled: dist/tests/  →  ../../bin/aiwerk-send-email.mjs
const CLI = path.resolve(__dirname, '../../bin/aiwerk-send-email.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RunResult = { code: number; stdout: string; stderr: string };

function runCli(args: string[], env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI, ...args], {
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

type FakeSmtpOptions = {
  authFail?: boolean;
  noGreeting?: boolean; // accept TCP but never send 220 → greetingTimeout fires
};

type FakeSmtpResult = {
  server: net.Server;
  port: number;
  capturedData: string[];
  capturedHeaders: string[];
};

function createFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtpResult> {
  const capturedData: string[] = [];
  const capturedHeaders: string[] = [];

  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      if (options.noGreeting) return; // never respond → triggers greetingTimeout

      socket.write('220 test.example.com ESMTP ready\r\n');

      let buffer = '';
      let inData = false;
      let dataLines: string[] = [];
      let authStep = 0; // 0=normal, 1=waiting-username, 2=waiting-password

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split('\r\n');
        buffer = parts.pop() ?? '';

        for (const line of parts) {
          if (inData) {
            if (line === '.') {
              inData = false;
              const full = dataLines.join('\r\n');
              const headerEnd = full.indexOf('\r\n\r\n');
              capturedHeaders.push(headerEnd >= 0 ? full.slice(0, headerEnd) : full);
              capturedData.push(full);
              dataLines = [];
              socket.write('250 2.0.0 OK: Message queued\r\n');
            } else {
              dataLines.push(line);
            }
            continue;
          }

          // AUTH multi-step state machine
          if (authStep === 1) {
            authStep = 2;
            socket.write('334 UGFzc3dvcmQ6\r\n'); // "Password:"
            continue;
          }
          if (authStep === 2) {
            authStep = 0;
            socket.write(
              options.authFail
                ? '535 5.7.8 Authentication credentials invalid\r\n'
                : '235 2.7.0 Authentication successful\r\n',
            );
            continue;
          }

          const upper = line.toUpperCase().trim();
          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
            socket.write('250-test.example.com Hello\r\n250 AUTH LOGIN PLAIN\r\n');
          } else if (upper === 'AUTH LOGIN') {
            authStep = 1;
            socket.write('334 VXNlcm5hbWU6\r\n'); // "Username:"
          } else if (upper.startsWith('AUTH PLAIN')) {
            socket.write(
              options.authFail
                ? '535 5.7.8 Authentication credentials invalid\r\n'
                : '235 2.7.0 Authentication successful\r\n',
            );
          } else if (upper.startsWith('MAIL FROM')) {
            socket.write('250 2.1.0 OK\r\n');
          } else if (upper.startsWith('RCPT TO')) {
            socket.write('250 2.1.5 OK\r\n');
          } else if (upper === 'DATA') {
            inData = true;
            socket.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
          } else if (upper === 'QUIT') {
            socket.write('221 2.0.0 Bye\r\n');
            socket.end();
          }
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port, capturedData, capturedHeaders });
    });
  });
}

// Base env for all SMTP tests
function smtpEnv(port: number, extra: Record<string, string> = {}): Record<string, string> {
  return {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_USER: 'test@example.com',
    SMTP_PASS: 'hunter2',
    SMTP_FROM: 'test@example.com',
    SMTP_TLS: 'false',
    SMTP_TIMEOUT_MS: '3000',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('missing required arg --to → exit 2 + stderr message', async () => {
  const r = await runCli(
    ['--subject', 'Hello', '--body', 'Hi'],
    { SMTP_HOST: 'x', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'u' },
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--to/);
});

test('missing required arg --body/--html → exit 2 + stderr message', async () => {
  const r = await runCli(
    ['--to', 'x@x.com', '--subject', 'S'],
    { SMTP_HOST: 'x', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'u' },
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--body or --html/);
});

test('missing required env var SMTP_HOST → exit 2 + stderr message', async () => {
  const r = await runCli(
    ['--to', 'x@x.com', '--subject', 'S', '--body', 'B'],
    { SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'u' },
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /SMTP_HOST/);
});

test('missing required env var SMTP_PASS → exit 2 + stderr message', async () => {
  const r = await runCli(
    ['--to', 'x@x.com', '--subject', 'S', '--body', 'B'],
    { SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_FROM: 'u' },
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /SMTP_PASS/);
});

test('successful send → exit 0 + JSON output with ok:true and messageId', async () => {
  const fake = await createFakeSmtp();
  try {
    const r = await runCli(
      ['--to', 'alice@example.com', '--subject', 'Test', '--body', 'Hello'],
      smtpEnv(fake.port),
    );
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.ok(typeof json.messageId === 'string' && json.messageId.length > 0);
    assert.ok(json.envelope);
  } finally {
    fake.server.close();
  }
});

test('SMTP auth fail → exit 1 + stderr message, no credential leak', async () => {
  const fake = await createFakeSmtp({ authFail: true });
  try {
    const r = await runCli(
      ['--to', 'alice@example.com', '--subject', 'Test', '--body', 'Hello'],
      smtpEnv(fake.port),
    );
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Send failed/);
    assert.doesNotMatch(r.stderr, /hunter2/, 'SMTP_PASS must not appear in stderr');
  } finally {
    fake.server.close();
  }
});

test('connection timeout (no greeting) → exit 1 + clear message', async () => {
  const fake = await createFakeSmtp({ noGreeting: true });
  try {
    const r = await runCli(
      ['--to', 'a@b.com', '--subject', 'T', '--body', 'B'],
      smtpEnv(fake.port, { SMTP_TIMEOUT_MS: '500' }),
    );
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Send failed/);
  } finally {
    fake.server.close();
  }
});

test('--body and --html together → multipart message (both Content-Type variants present)', async () => {
  const fake = await createFakeSmtp();
  try {
    const r = await runCli(
      [
        '--to', 'alice@example.com',
        '--subject', 'Multipart',
        '--body', 'Plain text version',
        '--html', '<p>HTML version</p>',
      ],
      smtpEnv(fake.port),
    );
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.ok(fake.capturedData.length > 0, 'no email data captured');
    const data = fake.capturedData[0]!;
    assert.match(data, /text\/plain/i);
    assert.match(data, /text\/html/i);
  } finally {
    fake.server.close();
  }
});

test('--in-reply-to header is embedded in sent message', async () => {
  const fake = await createFakeSmtp();
  try {
    const r = await runCli(
      [
        '--to', 'alice@example.com',
        '--subject', 'Re: invoice',
        '--body', 'Got it.',
        '--in-reply-to', '<original@mail.example.com>',
      ],
      smtpEnv(fake.port),
    );
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.ok(fake.capturedData.length > 0, 'no email data captured');
    assert.match(fake.capturedHeaders[0]!, /In-Reply-To:.*original@mail\.example\.com/i);
  } finally {
    fake.server.close();
  }
});

test('cred-leak guard: stderr never contains SMTP_PASS value', async () => {
  // Simulate auth failure which might include credentials in error messages
  const fake = await createFakeSmtp({ authFail: true });
  try {
    const r = await runCli(
      ['--to', 'a@b.com', '--subject', 'T', '--body', 'B'],
      smtpEnv(fake.port, { SMTP_PASS: 'super-secret-password-12345' }),
    );
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stderr, /super-secret-password-12345/);
  } finally {
    fake.server.close();
  }
});
