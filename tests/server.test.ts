import test from 'node:test';
import assert from 'node:assert/strict';

import { toolSchemas } from '../src/server.js';
import { buildSearchCriteria, ImapClient, type ImapConfig } from '../src/imap-client.js';
import { readSmtpConfig } from '../src/smtp-client.js';

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
  const result = toolSchemas.email_reply.safeParse({ body: 'Reply body' });
  assert.equal(result.success, false);
});

test('validation: email_reply requires body', () => {
  const result = toolSchemas.email_reply.safeParse({ uid: 123 });
  assert.equal(result.success, false);
});

test('validation: email_attachment requires uid', () => {
  const result = toolSchemas.email_attachment.safeParse({});
  assert.equal(result.success, false);
});

test('validation: email_attachment index must be >= 0', () => {
  const result = toolSchemas.email_attachment.safeParse({ uid: 1, index: -1 });
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
    getMailboxLock: async (_path: string) => ({
      release: () => {},
    }),
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
        flags: new Set(['\\Seen']),
        bodyParts: new Map([['TEXT', Buffer.from('Snippet from mocked message body')]]),
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
    clientFactory: mockFactory,
  });

  const result = await client.listEmails('INBOX', 10, false);

  assert.equal(connected, true);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.uid, 100);
  assert.equal(result[0]?.snippet, 'Snippet from mocked message body');
});

test('imap client: readEmail parses multipart body and attachments with mailparser', async () => {
  const source = Buffer.from(
    [
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Report',
      'Date: Sun, 15 Mar 2026 09:00:00 +0000',
      'Content-Type: multipart/mixed; boundary="abc"',
      '',
      '--abc',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Body text',
      '--abc',
      'Content-Type: application/pdf; name="report.pdf"',
      'Content-Disposition: attachment; filename="report.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQ=',
      '--abc--',
      '',
    ].join('\r\n')
  );

  const mockFactory = (_cfg: ImapConfig) => ({
    usable: true,
    on: () => {},
    connect: async () => {},
    logout: async () => {},
    close: () => {},
    getMailboxLock: async (_path: string) => ({
      release: () => {},
    }),
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
    clientFactory: mockFactory,
  });

  const result = await client.readEmail(77, 'INBOX', 'text');
  assert.equal(result.uid, 77);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0]?.filename, 'report.pdf');
  assert.equal(result.body.trim(), 'Body text');
});

test('imap client: getAttachment returns metadata list or selected attachment content', async () => {
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
    getMailboxLock: async (_path: string) => ({
      release: () => {},
    }),
    search: async () => [],
    async *fetch() {
      return;
    },
    fetchOne: async () => ({
      uid: 11,
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
    clientFactory: mockFactory,
  });

  const metadata = await client.getAttachment(11, 'INBOX');
  assert.equal('attachments' in metadata, true);
  if ('attachments' in metadata) {
    assert.equal(metadata.attachments.length, 1);
    assert.equal(metadata.attachments[0]?.filename, 'notes.txt');
    assert.equal(metadata.attachments[0]?.size, 5);
    assert.equal(metadata.attachments[0]?.contentType, 'text/plain');
  }

  const attachment = await client.getAttachment(11, 'INBOX', 'notes.txt');
  assert.equal('content' in attachment, true);
  if ('content' in attachment) {
    assert.equal(attachment.filename, 'notes.txt');
    assert.equal(attachment.content, Buffer.from('hello').toString('base64'));
  }
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
    getMailboxLock: async (_path: string) => ({
      release: () => {},
    }),
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
    clientFactory: mockFactory,
  });

  const reply = await client.getReplyContext(22, 'INBOX');
  assert.equal(reply.messageId, '<msg1@example.com>');
  assert.deepEqual(reply.references, ['<old1@example.com>', '<old2@example.com>']);
  assert.equal(reply.subject, 'Original');
});
