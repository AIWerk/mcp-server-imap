import { ImapFlow } from 'imapflow';

export type EmailAddress = { name?: string; address?: string };

export type EmailListItem = {
  uid: number;
  from: string[];
  to: string[];
  subject: string;
  date: string | null;
  flags: string[];
  snippet: string;
};

export type EmailAttachment = {
  filename: string;
  size: number;
  contentType: string;
};

export type EmailReadResult = {
  uid: number;
  from: string[];
  to: string[];
  cc: string[];
  subject: string;
  date: string | null;
  body: string;
  attachments: EmailAttachment[];
};

export type FolderInfo = {
  name: string;
  path: string;
  delimiter: string;
  specialUse?: string;
  messageCount: number;
  unseenCount: number;
};

export type EmailSearchParams = {
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  since?: string;
  before?: string;
  unread?: boolean;
};

export type ImapConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls: boolean;
  timeoutMs: number;
};

type ImapFlowLike = {
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  close: () => void;
  usable: boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  getMailboxLock: (path: string) => Promise<{ release: () => void }>;
  search: (query: Record<string, unknown>, options?: { uid?: boolean }) => Promise<number[] | false>;
  fetch: (
    range: string | number[] | Record<string, unknown>,
    query: Record<string, unknown>,
    options?: { uid?: boolean }
  ) => AsyncIterable<{ uid: number; envelope?: any; flags?: Set<string>; bodyParts?: Map<string, Buffer>; internalDate?: Date }>;
  fetchOne: (
    range: string | number,
    query: Record<string, unknown>,
    options?: { uid?: boolean }
  ) => Promise<{
    uid: number;
    envelope?: any;
    source?: Buffer;
    bodyStructure?: any;
  } | false>;
  list: () => Promise<Array<{ path: string; name?: string; delimiter?: string; specialUse?: string }>>;
  status: (path: string, query: { messages?: boolean; unseen?: boolean }) => Promise<{ messages?: number; unseen?: number }>;
  messageMove: (uids: number[], destination: string, options?: { uid?: boolean }) => Promise<unknown>;
  messageFlagsAdd: (uids: number[], flags: string[], options?: { uid?: boolean }) => Promise<boolean>;
  messageFlagsRemove: (uids: number[], flags: string[], options?: { uid?: boolean }) => Promise<boolean>;
};

export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function readImapConfig(env: NodeJS.ProcessEnv = process.env): ImapConfig {
  const host = env.IMAP_HOST?.trim() ?? '';
  const user = env.IMAP_USER?.trim() ?? '';
  const pass = env.IMAP_PASS ?? '';

  if (!host || !user || !pass) {
    throw new Error('IMAP configuration missing: IMAP_HOST, IMAP_USER and IMAP_PASS are required');
  }

  const port = Number(env.IMAP_PORT ?? 993);
  const timeoutMs = Number(env.IMAP_TIMEOUT ?? 30000);

  return {
    host,
    user,
    pass,
    port: Number.isFinite(port) ? port : 993,
    tls: parseBool(env.IMAP_TLS, true),
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000,
  };
}

export function formatAddresses(addresses: EmailAddress[] | undefined): string[] {
  if (!addresses || addresses.length === 0) return [];
  return addresses
    .map((entry) => {
      if (!entry.address && !entry.name) return '';
      if (!entry.name) return entry.address ?? '';
      if (!entry.address) return entry.name;
      return `${entry.name} <${entry.address}>`;
    })
    .filter(Boolean);
}

export function buildSearchCriteria(params: EmailSearchParams): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  if (params.unread) {
    query.seen = false;
  }

  const header: Record<string, string> = {};
  if (params.from) header.from = params.from;
  if (params.to) header.to = params.to;
  if (params.subject) header.subject = params.subject;
  if (Object.keys(header).length > 0) {
    query.header = header;
  }

  if (params.query) {
    query.or = [{ subject: params.query }, { body: params.query }];
  }

  if (params.since) {
    const since = new Date(params.since);
    if (!Number.isNaN(since.valueOf())) query.since = since;
  }

  if (params.before) {
    const before = new Date(params.before);
    if (!Number.isNaN(before.valueOf())) query.before = before;
  }

  return query;
}

function extractSnippet(parts?: Map<string, Buffer>): string {
  if (!parts || parts.size === 0) return '';
  const buf = parts.get('TEXT') ?? parts.values().next().value;
  if (!buf) return '';
  return buf
    .toString('utf8')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function decodeBody(source: Buffer | undefined, format: 'text' | 'html'): string {
  if (!source) return '';
  const raw = source.toString('utf8');
  const split = raw.split(/\r?\n\r?\n/);
  if (split.length < 2) return raw;

  const body = split.slice(1).join('\n\n');
  if (format === 'html') return body;

  return body
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectAttachments(node: any, out: EmailAttachment[]): void {
  if (!node) return;

  const filename = node?.dispositionParameters?.filename ?? node?.parameters?.name;
  const disposition = String(node?.disposition ?? '').toLowerCase();

  if (filename || disposition === 'attachment') {
    out.push({
      filename: filename ?? 'attachment',
      size: Number(node?.size ?? 0),
      contentType: `${node?.type ?? 'application'}/${node?.subtype ?? 'octet-stream'}`,
    });
  }

  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) collectAttachments(child, out);
  }
}

function normalizeImapError(error: unknown, config?: Pick<ImapConfig, 'host' | 'port'>): Error {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('auth') || lower.includes('login')) {
    return new Error('IMAP authentication failed — check credentials');
  }

  if (lower.includes('timeout')) {
    return new Error('IMAP operation timed out — adjust IMAP_TIMEOUT (default 30000ms)');
  }

  if (config) {
    return new Error(`IMAP connection failed: ${config.host}:${config.port} — check IMAP_HOST, IMAP_USER, IMAP_PASS`);
  }

  return new Error(`IMAP error: ${message}`);
}

export class ImapClient {
  private readonly config: ImapConfig;
  private readonly createClient: (cfg: ImapConfig) => ImapFlowLike;
  private client: ImapFlowLike | null = null;
  private connecting: Promise<ImapFlowLike> | null = null;

  constructor(opts?: { env?: NodeJS.ProcessEnv; clientFactory?: (cfg: ImapConfig) => ImapFlowLike }) {
    this.config = readImapConfig(opts?.env);
    this.createClient =
      opts?.clientFactory ??
      ((cfg) =>
        new ImapFlow({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.tls,
          auth: { user: cfg.user, pass: cfg.pass },
          socketTimeout: cfg.timeoutMs,
        }) as unknown as ImapFlowLike);
  }

  private async ensureConnected(): Promise<ImapFlowLike> {
    if (this.client && this.client.usable) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const client = this.createClient(this.config);
      client.on('close', () => {
        this.client = null;
      });
      client.on('error', () => {
        this.client = null;
      });

      try {
        await client.connect();
      } catch (error) {
        throw normalizeImapError(error, this.config);
      }

      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async close(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
    this.client = null;
  }

  async listEmails(folder = 'INBOX', limit = 20, unreadOnly = false): Promise<EmailListItem[]> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);
    try {
      const range = `*:${Math.max(1, limit)}`;
      const items: EmailListItem[] = [];
      const criteria = unreadOnly ? { seen: false } : { all: true };

      for await (const msg of client.fetch(criteria, {
        envelope: true,
        flags: true,
        internalDate: true,
        bodyParts: [{ key: 'TEXT', start: 0, maxLength: 200 }],
      }, { uid: true })) {
        items.push({
          uid: msg.uid,
          from: formatAddresses(msg.envelope?.from),
          to: formatAddresses(msg.envelope?.to),
          subject: msg.envelope?.subject ?? '',
          date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          flags: Array.from(msg.flags ?? []),
          snippet: extractSnippet(msg.bodyParts),
        });
      }

      return items
        .sort((a, b) => b.uid - a.uid)
        .slice(0, limit);
    } catch (error) {
      throw normalizeImapError(error, this.config);
    } finally {
      lock.release();
    }
  }

  async readEmail(uid: number, folder = 'INBOX', format: 'text' | 'html' = 'text'): Promise<EmailReadResult> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);

    try {
      const message = await client.fetchOne(uid, {
        envelope: true,
        source: true,
        bodyStructure: true,
      }, { uid: true });

      if (!message) {
        throw new Error(`Message not found: uid ${uid}`);
      }

      const attachments: EmailAttachment[] = [];
      collectAttachments(message.bodyStructure, attachments);

      return {
        uid: message.uid,
        from: formatAddresses(message.envelope?.from),
        to: formatAddresses(message.envelope?.to),
        cc: formatAddresses(message.envelope?.cc),
        subject: message.envelope?.subject ?? '',
        date: message.envelope?.date ? new Date(message.envelope.date).toISOString() : null,
        body: decodeBody(message.source, format),
        attachments,
      };
    } catch (error) {
      throw normalizeImapError(error, this.config);
    } finally {
      lock.release();
    }
  }

  async searchEmails(folder = 'INBOX', params: EmailSearchParams = {}): Promise<EmailListItem[]> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);

    try {
      const criteria = buildSearchCriteria(params);
      const searchResult = await client.search(criteria, { uid: true });
      const uids = searchResult === false ? [] : searchResult;
      if (uids.length === 0) return [];

      const out: EmailListItem[] = [];
      for await (const msg of client.fetch(uids, {
        envelope: true,
        flags: true,
        bodyParts: [{ key: 'TEXT', start: 0, maxLength: 200 }],
      }, { uid: true })) {
        out.push({
          uid: msg.uid,
          from: formatAddresses(msg.envelope?.from),
          to: formatAddresses(msg.envelope?.to),
          subject: msg.envelope?.subject ?? '',
          date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          flags: Array.from(msg.flags ?? []),
          snippet: extractSnippet(msg.bodyParts),
        });
      }

      return out.sort((a, b) => b.uid - a.uid);
    } catch (error) {
      throw normalizeImapError(error, this.config);
    } finally {
      lock.release();
    }
  }

  async listFolders(): Promise<FolderInfo[]> {
    const client = await this.ensureConnected();
    try {
      const boxes = await client.list();
      const out: FolderInfo[] = [];

      for (const box of boxes) {
        const status = await client.status(box.path, { messages: true, unseen: true });
        out.push({
          name: box.name ?? box.path,
          path: box.path,
          delimiter: box.delimiter ?? '/',
          specialUse: box.specialUse,
          messageCount: Number(status.messages ?? 0),
          unseenCount: Number(status.unseen ?? 0),
        });
      }

      return out;
    } catch (error) {
      throw normalizeImapError(error, this.config);
    }
  }

  async moveEmails(uids: number[], from = 'INBOX', to: string): Promise<number> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(from);
    try {
      await client.messageMove(uids, to, { uid: true });
      return uids.length;
    } catch (error) {
      throw normalizeImapError(error, this.config);
    } finally {
      lock.release();
    }
  }

  async setFlags(
    uids: number[],
    action: 'read' | 'unread' | 'star' | 'unstar',
    folder = 'INBOX'
  ): Promise<number> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);
    try {
      if (action === 'read') await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      if (action === 'unread') await client.messageFlagsRemove(uids, ['\\Seen'], { uid: true });
      if (action === 'star') await client.messageFlagsAdd(uids, ['\\Flagged'], { uid: true });
      if (action === 'unstar') await client.messageFlagsRemove(uids, ['\\Flagged'], { uid: true });
      return uids.length;
    } catch (error) {
      throw normalizeImapError(error, this.config);
    } finally {
      lock.release();
    }
  }

  async detectTrashFolder(): Promise<string> {
    const folders = await this.listFolders();

    const bySpecialUse = folders.find((folder) => String(folder.specialUse ?? '').toLowerCase() === '\\trash');
    if (bySpecialUse) return bySpecialUse.path;

    const common = ['trash', 'deleted messages', 'deleted', 'bin', 'papierkorb', 'gelöscht'];
    const fallback = folders.find((folder) => common.some((name) => folder.path.toLowerCase().includes(name)));

    return fallback?.path ?? 'Trash';
  }

  async deleteEmails(uids: number[], folder = 'INBOX'): Promise<number> {
    const trash = await this.detectTrashFolder();
    return this.moveEmails(uids, folder, trash);
  }
}
