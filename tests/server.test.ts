import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

import { toolSchemas } from '../src/server.js';
import { buildSearchCriteria, ImapClient, type ImapConfig } from '../src/imap-client.js';
import { readSmtpConfig, SmtpClient } from '../src/smtp-client.js';

test('validation: email_read requires uid', () => {
  const result = toolSchemas.email_read.safeParse({});
  assert.equal(result.success, false);
});

test('validation: email_move requires to', () => {
  const result = toolSchemas.email_move.safeParse({ uids: [1] });
  assert.equal(result.success, false);
});

test('validation: email_flag only allows known actions', () => {
  const result = toolSchemas.email_flag.safeParse({ uids: [1], action: 'archive' });
  assert.equal(result.success, false);
});

test('validation: email_send requires subject', () => {
  const result = toolSchemas.email_send.safeParse({ to: 'a@b.com', body: 'Hi' });
  assert.equal(result.success, false);
});

test('validation: email_reply requires uid', () => {
  const result = toolSchemas.email_reply.safeParse({ body: 'Hello' });
  assert.equal(result.success, false);
});

test('validation: email_reply requires body', () => {
  const result = toolSchemas.email_reply.safeParse({ uid: 1 });
  assert.equal(result.success, false);
});

test('validation: email_attachment requires uid', () => {
  const result = toolSchemas.email_attachment.safeParse({});
  assert.equal(result.success, false);
});

test('validation: email_attachment index must be >= 0', () => {
  const result = toolSchemas.email_attachment.safeParse({ uid: 3, index: -1 });
  assert.equal(result.success, false);
});

test('search criteria: maps unread=true to seen=false', () => {
  const criteria = buildSearchCriteria({ unread: true });
  assert.equal(criteria.seen, false);
});

test('search criteria: maps header filters', () => {
  const criteria = buildSearchCriteria({ from: 'alice@example.com', subject: 'Invoice' });
  assert.deepEqual(criteria.header, { from: 'alice@example.com', subject: 'Invoice' });
});

test('search criteria: maps query to OR(subject/body)', () => {
  const criteria = buildSearchCriteria({ query: 'urgent' });
  assert.deepEqual(criteria.or, [{ subject: 'urgent' }, { body: 'urgent' }]);
});

test('search criteria: parses since and before dates', () => {
  const criteria = buildSearchCriteria({ since: '2026-03-01T00:00:00.000Z', before: '2026-03-10T00:00:00.000Z' });
  assert.ok(criteria.since instanceof Date);
  assert.ok(criteria.before instanceof Date);
});

test('smtp defaults: SMTP values fallback to IMAP env', () => {
  const cfg = readSmtpConfig({
    IMAP_HOST: 'imap.host',
    IMAP_USER: 'imap-user',
    IMAP_PASS: 'secret',
  });

  assert.equal(cfg.host, 'imap.host');
  assert.equal(cfg.user, 'imap-user');
  assert.equal(cfg.pass, 'secret');
  assert.equal(cfg.from, 'imap-user');
  assert.equal(cfg.port, 465);
});

test('smtp defaults: SMTP_HOST overrides IMAP_HOST', () => {
  const cfg = readSmtpConfig({
    IMAP_HOST: 'imap.host',
    IMAP_USER: 'imap-user',
    IMAP_PASS: 'secret',
    SMTP_HOST: 'smtp.host',
    SMTP_USER: 'smtp-user',
  });

  assert.equal(cfg.host, 'smtp.host');
  assert.equal(cfg.user, 'smtp-user');
});

test('smtp client: caches transporter and closes it', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  let createCount = 0;
  let sendCount = 0;
  let closed = false;

  const fakeTransporter = {
    sendMail: async () => {
      sendCount += 1;
      return { messageId: `id-${sendCount}`, accepted: ['ok@example.com'] };
    },
    close: () => {
      closed = true;
    },
  };

  (nodemailer as any).createTransport = () => {
    createCount += 1;
    return fakeTransporter;
  };

  try {
    const client = new SmtpClient({
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'user@example.com',
      SMTP_PASS: 'secret',
    });

    await client.sendMail({ to: 'a@example.com', subject: 'One', body: 'First' });
    await client.sendMail({ to: 'b@example.com', subject: 'Two', body: 'Second' });

    assert.equal(createCount, 1);
    assert.equal(sendCount, 2);

    await client.close();
    assert.equal(closed, true);
  } finally {
    (nodemailer as any).createTransport = originalCreateTransport;
  }
});

test('imap client: listEmails uses mock imapflow and returns snippet', async () => {
  let connected = false;
  const mockFactory = (_cfg: ImapConfig) => ({
    usable: true,
    on: () => {},
    connect: async () => {
      connected = true;
    },
    logout: async () => {},
    close: () => {},
    getMailboxLock: async (_path: string) => ({ release: () => {} }),
    search: async () => [100],
    async *fetch() {
      yield {
        uid: 100,
        envelope: {
          from: [{ name: 'Alice', address: 'alice@example.com' }],
          to: [{ address: 'bob@example.com' }],
          subject: 'Hello',
          date: new Date('2026-03-15T10:00:00.000Z'),
        },
        flags: new Set<string>(['\\Seen']),
        bodyParts: new Map<string, Buffer>([['TEXT', Buffer.from('Snippet from mocked message body')]]),
      };
    },
    fetchOne: async () => false as const,
    list: async () => [],
    status: async () => ({ messages: 0, unseen: 0 }),
    messageMove: async () => ({}),
    messageFlagsAdd: async () => true,
    messageFlagsRemove: async () => true,
  });

  const client = new ImapClient({
    env: {
      IMAP_HOST: 'imap.example.com',
      IMAP_USER: 'user@example.com',
      IMAP_PASS: 'secret',
    },
    clientFactory: mockFactory as any,
  });

  const result = await client.listEmails('INBOX', 10, false);

  assert.equal(connected, true);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.uid, 100);
  assert.equal(result[0]?.snippet, 'Snippet from mocked message body');
});

test('imap client: listEmails falls back to source parsing for snippet', async () => {
  const mockFactory = (_cfg: ImapConfig) => ({
    usable: true,
    on: () => {},
    connect: async () => {},
    logout: async () => {},
    close: () => {},
    getMailboxLock: async (_path: string) => ({ release: () => {} }),
    search: async () => [10],
    async *fetch() {
      yield {
        uid: 10,
        envelope: { from: [], to: [], subject: 'Multipart' },
        flags: new Set<string>(),
        bodyParts: new Map<string, Buffer>(),
        source: Buffer.from('From: a@example.com\r\nTo: b@example.com\r\nSubject: Multipart\r\n\r\nFallback snippet body text'),
      };
    },
    fetchOne: async () => false as const,
    list: async () => [],
    status: async () => ({ messages: 0, unseen: 0 }),
    messageMove: async () => ({}),
    messageFlagsAdd: async () => true,
    messageFlagsRemove: async () => true,
  });

  const client = new ImapClient({
    env: {
      IMAP_HOST: 'imap.example.com',
      IMAP_USER: 'user@example.com',
      IMAP_PASS: 'secret',
    },
    clientFactory: mockFactory as any,
  });

  const result = await client.listEmails('INBOX', 10, false);
  assert.equal(result[0]?.snippet, 'Fallback snippet body text');
});

test('imap client: readEmail parses body and attachments using mailparser', async () => {
  const rawMime = [
    'From: alice@example.com',
    'To: bob@example.com',
    'Subject: Report',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="abc"',
    '',
    '--abc',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'Body text',
    '--abc',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="report.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'aGVsbG8=',
    '--abc--',
    '',
  ].join('\r\n');

  const mockFactory = (_cfg: ImapConfig) => ({
    usable: true,
    on: () => {},
    connect: async () => {},
    logout: async () => {},
    close: () => {},
    getMailboxLock: async (_path: string) => ({ release: () => {} }),
    search: async () => [],
    async *fetch() {
      return;
    },
    fetchOne: async () => ({
      uid: 77,
      envelope: {
        from: [{ address: 'alice@example.com' }],
        to: [{ address: 'bob@example.com' }],
        cc: [{ address: 'cc@example.com' }],
        subject: 'Report',
        date: new Date('2026-03-15T09:00:00.000Z'),
      },
      source: Buffer.from(rawMime),
    }),
    list: async () => [],
    status: async () => ({ messages: 0, unseen: 0 }),
    messageMove: async () => ({}),
    messageFlagsAdd: async () => true,
    messageFlagsRemove: async () => true,
  });

  const client = new ImapClient({
    env: {
      IMAP_HOST: 'imap.example.com',
      IMAP_USER: 'user@example.com',
      IMAP_PASS: 'secret',
    },
    clientFactory: mockFactory as any,
  });

  const result = await client.readEmail(77, 'INBOX', 'text');
  assert.equal(result.uid, 77);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0]?.filename, 'report.pdf');
  assert.equal(result.body.trim(), 'Body text');
});

test('imap client: getReplyContext returns message id and references', async () => {
  const source = Buffer.from(
    [
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Original',
      'Message-ID: <msg1@example.com>',
      'References: <old1@example.com> <old2@example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Hello',
      '',
    ].join('\r\n')
  );

  const mockFactory = (_cfg: ImapConfig) => ({
    usable: true,
    on: () => {},
    connect: async () => {},
    logout: async () => {},
    close: () => {},
    getMailboxLock: async (_path: string) => ({ release: () => {} }),
    search: async () => [],
    async *fetch() {
      return;
    },
    fetchOne: async () => ({
      uid: 22,
      envelope: {
        from: [{ address: 'alice@example.com' }],
        to: [{ address: 'bob@example.com' }],
        cc: [{ address: 'carol@example.com' }],
        subject: 'Original',
      },
      source,
    }),
    list: async () => [],
    status: async () => ({ messages: 0, unseen: 0 }),
    messageMove: async () => ({}),
    messageFlagsAdd: async () => true,
    messageFlagsRemove: async () => true,
  });

  const client = new ImapClient({
    env: {
      IMAP_HOST: 'imap.example.com',
      IMAP_USER: 'user@example.com',
      IMAP_PASS: 'secret',
    },
    clientFactory: mockFactory as any,
  });

  const reply = await client.getReplyContext(22, 'INBOX');
  assert.equal(reply.messageId, '<msg1@example.com>');
  assert.deepEqual(reply.references, ['<old1@example.com>', '<old2@example.com>']);
  assert.equal(reply.subject, 'Original');
});

test('imap client: getAttachment returns metadata list and selected content', async () => {
  const source = Buffer.from(
    [
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Attachments',
      'Content-Type: multipart/mixed; boundary="mix"',
      '',
      '--mix',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'See attachments',
      '--mix',
      'Content-Type: text/plain; name="notes.txt"',
      'Content-Disposition: attachment; filename="notes.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      'aGVsbG8=',
      '--mix--',
      '',
    ].join('\r\n')
  );

  const mockFactory = (_cfg: ImapConfig) => ({
    usable: true,
    on: () => {},
    connect: async () => {},
    logout: async () => {},
    close: () => {},
    getMailboxLock: async (_path: string) => ({ release: () => {} }),
    search: async () => [],
    async *fetch() {
      return;
    },
    fetchOne: async () => ({ uid: 11, source }),
    list: async () => [],
    status: async () => ({ messages: 0, unseen: 0 }),
    messageMove: async () => ({}),
    messageFlagsAdd: async () => true,
    messageFlagsRemove: async () => true,
  });

  const client = new ImapClient({
    env: {
      IMAP_HOST: 'imap.example.com',
      IMAP_USER: 'user@example.com',
      IMAP_PASS: 'secret',
    },
    clientFactory: mockFactory as any,
  });

  const metadata = await client.getAttachment(11, 'INBOX');
  assert.equal('attachments' in metadata, true);
  if ('attachments' in metadata) {
    assert.equal(metadata.attachments.length, 1);
    assert.equal(metadata.attachments[0]?.filename, 'notes.txt');
  }

  const attachment = await client.getAttachment(11, 'INBOX', 'notes.txt');
  assert.equal('content' in attachment, true);
  if ('content' in attachment) {
    assert.equal(attachment.filename, 'notes.txt');
    assert.equal(attachment.content, Buffer.from('hello').toString('base64'));
  }
});

test('imap client: searchEmails respects limit parameter', async () => {
  let fetchedRange: number[] = [];

  const mockFactory = (_cfg: ImapConfig) => ({
    usable: true,
    on: () => {},
    connect: async () => {},
    logout: async () => {},
    close: () => {},
    getMailboxLock: async (_path: string) => ({ release: () => {} }),
    search: async () => [1, 2, 3, 4, 5],
    async *fetch(range: string | number[] | Record<string, unknown>) {
      fetchedRange = Array.isArray(range) ? range : [];
      for (const uid of fetchedRange) {
        yield {
          uid,
          envelope: { from: [], to: [], subject: `S-${uid}`, date: new Date('2026-03-15T00:00:00.000Z') },
          flags: new Set<string>(),
          bodyParts: new Map<string, Buffer>([['TEXT', Buffer.from(`Snippet ${uid}`)]]),
        };
      }
    },
    fetchOne: async () => false as const,
    list: async () => [],
    status: async () => ({ messages: 0, unseen: 0 }),
    messageMove: async () => ({}),
    messageFlagsAdd: async () => true,
    messageFlagsRemove: async () => true,
  });

  const client = new ImapClient({
    env: {
      IMAP_HOST: 'imap.example.com',
      IMAP_USER: 'user@example.com',
      IMAP_PASS: 'secret',
    },
    clientFactory: mockFactory as any,
  });

  const result = await client.searchEmails('INBOX', {}, 2);

  assert.deepEqual(fetchedRange, [5, 4]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.uid), [5, 4]);
});
