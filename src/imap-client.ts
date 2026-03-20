import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

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
  cid?: string;
  partId?: string;
};

export type EmailAttachmentContent = EmailAttachment & {
  content: string;
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

export type EmailReplyContext = {
  from: string[];
  to: string[];
  cc: string[];
  subject: string;
  messageId?: string;
  references: string[];
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
  ) => AsyncIterable<{
    uid: number;
    envelope?: any;
    flags?: Set<string>;
    bodyParts?: Map<string, Buffer>;
    internalDate?: Date;
    source?: Buffer;
  }>;
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

import { parseBool } from './utils.js';

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

function toSnippet(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function normalizeMessageIds(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  const raw = String(value);
  const matches = raw.match(/<[^>]+>/g);
  if (matches && matches.length > 0) {
    return matches.map((item) => item.trim()).filter(Boolean);
  }

  return raw
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
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
  private readonly env: NodeJS.ProcessEnv;
  private config: ImapConfig | null = null;
  private readonly createClient: (cfg: ImapConfig) => ImapFlowLike;
  private client: ImapFlowLike | null = null;
  // Cache parsed emails to avoid double MIME parsing (e.g. list attachments then download one)
  private parsedCache = new Map<string, import('mailparser').ParsedMail>();
  private trashFolderCache: string | null = null;
  private connecting: Promise<ImapFlowLike> | null = null;

  constructor(opts?: { env?: NodeJS.ProcessEnv; clientFactory?: (cfg: ImapConfig) => ImapFlowLike }) {
    this.env = opts?.env ?? process.env;
    this.createClient =
      opts?.clientFactory ??
      ((cfg) =>
        new ImapFlow({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.tls,
          auth: { user: cfg.user, pass: cfg.pass },
          socketTimeout: cfg.timeoutMs,
          logger: parseBool(this.env.IMAP_DEBUG, false)
            ? undefined  // default pino logger (verbose)
            : false as any,  // suppress all IMAP protocol logging
        }) as unknown as ImapFlowLike);
  }

  private getConfig(): ImapConfig {
    if (!this.config) {
      this.config = readImapConfig(this.env);
    }
    return this.config;
  }

  private async ensureConnected(): Promise<ImapFlowLike> {
    if (this.client && this.client.usable) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const config = this.getConfig();
      const client = this.createClient(config);
      client.on('close', () => {
        this.client = null;
      });
      client.on('error', () => {
        this.client = null;
      });

      try {
        await client.connect();
      } catch (error) {
        throw normalizeImapError(error, config);
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
      const items: EmailListItem[] = [];
      const criteria = unreadOnly ? { seen: false } : { all: true };

      const uids = await client.search(criteria, { uid: true });
      if (!uids || (Array.isArray(uids) && uids.length === 0)) {
        return [];
      }
      const uidList = Array.isArray(uids) ? uids : [];
      const latestUids = uidList.sort((a, b) => b - a).slice(0, limit);

      if (latestUids.length === 0) return [];

      // Step 1: fetch with bodyParts only (no source — fast)
      const needsSourceFetch: number[] = [];
      for await (const msg of client.fetch(
        latestUids,
        {
          envelope: true,
          flags: true,
          internalDate: true,
          bodyParts: [{ key: 'TEXT', start: 0, maxLength: 200 }],
        },
        { uid: true }
      )) {
        const snippet = extractSnippet(msg.bodyParts);
        items.push({
          uid: msg.uid,
          from: formatAddresses(msg.envelope?.from),
          to: formatAddresses(msg.envelope?.to),
          subject: msg.envelope?.subject ?? '',
          date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          flags: Array.from(msg.flags ?? []),
          snippet,
        });
        if (!snippet) {
          needsSourceFetch.push(msg.uid);
        }
      }

      // Step 2: only fetch source for messages where bodyParts snippet was empty
      if (needsSourceFetch.length > 0) {
        for await (const msg of client.fetch(needsSourceFetch, { source: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source ?? Buffer.alloc(0));
          const snippet = toSnippet(parsed.text || '');
          const item = items.find((i) => i.uid === msg.uid);
          if (item) item.snippet = snippet;
        }
      }

      return items.sort((a, b) => b.uid - a.uid);
    } catch (error) {
      throw normalizeImapError(error, this.config ?? undefined);
    } finally {
      lock.release();
    }
  }

  async readEmail(uid: number, folder = 'INBOX', format: 'text' | 'html' = 'text'): Promise<EmailReadResult> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);

    try {
      const message = await client.fetchOne(
        uid,
        {
          envelope: true,
          source: true,
        },
        { uid: true }
      );

      if (!message) {
        throw new Error(`Message not found: uid ${uid}`);
      }

      const parsed = await simpleParser(message.source ?? Buffer.alloc(0));
      const body = format === 'html' ? String(parsed.html || parsed.textAsHtml || '') : parsed.text || '';
      const attachments = (parsed.attachments || []).map((attachment) => ({
        filename: attachment.filename || 'unnamed',
        size: attachment.size,
        contentType: attachment.contentType,
        cid: attachment.cid || undefined,
        partId: (attachment as { partId?: string }).partId || undefined,
      }));

      return {
        uid: message.uid,
        from: formatAddresses(message.envelope?.from),
        to: formatAddresses(message.envelope?.to),
        cc: formatAddresses(message.envelope?.cc),
        subject: message.envelope?.subject ?? '',
        date: message.envelope?.date ? new Date(message.envelope.date).toISOString() : null,
        body,
        attachments,
      };
    } catch (error) {
      throw normalizeImapError(error, this.config ?? undefined);
    } finally {
      lock.release();
    }
  }

  async searchEmails(folder = 'INBOX', params: EmailSearchParams = {}, limit = 50): Promise<EmailListItem[]> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);

    try {
      const criteria = buildSearchCriteria(params);
      const searchResult = await client.search(criteria, { uid: true });
      const allUids = searchResult === false ? [] : searchResult;
      if (allUids.length === 0) return [];

      const uids = allUids.sort((a, b) => b - a).slice(0, limit);

      const out: EmailListItem[] = [];
      const needsSourceFetch: number[] = [];
      for await (const msg of client.fetch(
        uids,
        {
          envelope: true,
          flags: true,
          bodyParts: [{ key: 'TEXT', start: 0, maxLength: 200 }],
        },
        { uid: true }
      )) {
        const snippet = extractSnippet(msg.bodyParts);
        out.push({
          uid: msg.uid,
          from: formatAddresses(msg.envelope?.from),
          to: formatAddresses(msg.envelope?.to),
          subject: msg.envelope?.subject ?? '',
          date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          flags: Array.from(msg.flags ?? []),
          snippet,
        });
        if (!snippet) {
          needsSourceFetch.push(msg.uid);
        }
      }

      if (needsSourceFetch.length > 0) {
        for await (const msg of client.fetch(needsSourceFetch, { source: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source ?? Buffer.alloc(0));
          const snippet = toSnippet(parsed.text || '');
          const item = out.find((entry) => entry.uid === msg.uid);
          if (item) item.snippet = snippet;
        }
      }

      return out.sort((a, b) => b.uid - a.uid);
    } catch (error) {
      throw normalizeImapError(error, this.config ?? undefined);
    } finally {
      lock.release();
    }
  }

  async getReplyContext(uid: number, folder = 'INBOX'): Promise<EmailReplyContext> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);

    try {
      const message = await client.fetchOne(
        uid,
        {
          envelope: true,
          source: true,
        },
        { uid: true }
      );

      if (!message) {
        throw new Error(`Message not found: uid ${uid}`);
      }

      const parsed = await simpleParser(message.source ?? Buffer.alloc(0));
      const headerReferences = parsed.headers.get('references');
      const parsedReferences = normalizeMessageIds(parsed.references);
      const references = parsedReferences.length > 0 ? parsedReferences : normalizeMessageIds(headerReferences);

      return {
        from: formatAddresses(message.envelope?.from),
        to: formatAddresses(message.envelope?.to),
        cc: formatAddresses(message.envelope?.cc),
        subject: message.envelope?.subject ?? '',
        messageId: parsed.messageId || undefined,
        references,
      };
    } catch (error) {
      throw normalizeImapError(error, this.config ?? undefined);
    } finally {
      lock.release();
    }
  }

  async getAttachment(
    uid: number,
    folder = 'INBOX',
    filename?: string,
    index?: number
  ): Promise<{ attachments: EmailAttachment[] } | EmailAttachmentContent> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);

    try {
      const cacheKey = `${folder}:${uid}`;
      let parsed = this.parsedCache.get(cacheKey);
      if (parsed) {
        // Mark as recently used to keep eviction order as true LRU.
        this.parsedCache.delete(cacheKey);
        this.parsedCache.set(cacheKey, parsed);
      } else {
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message) {
          throw new Error(`Message not found: uid ${uid}`);
        }
        parsed = await simpleParser(message.source ?? Buffer.alloc(0));
        this.parsedCache.set(cacheKey, parsed);
        // Evict old entries (keep max 10)
        if (this.parsedCache.size > 10) {
          const oldest = this.parsedCache.keys().next().value;
          if (oldest) this.parsedCache.delete(oldest);
        }
      }
      const attachments = (parsed.attachments || []).map((attachment) => ({
        filename: attachment.filename || 'unnamed',
        size: attachment.size,
        contentType: attachment.contentType,
        cid: attachment.cid || undefined,
        partId: (attachment as { partId?: string }).partId || undefined,
      }));

      if (filename === undefined && index === undefined) {
        return { attachments };
      }

      const parsedAttachments = parsed.attachments || [];
      const pickedIndex =
        filename !== undefined
          ? attachments.findIndex((attachment) => attachment.filename === filename)
          : (index ?? -1);

      const pickedMetadata = attachments[pickedIndex];
      const pickedParsed = parsedAttachments[pickedIndex];

      if (!pickedMetadata || !pickedParsed) {
        throw new Error('Attachment not found');
      }

      return {
        ...pickedMetadata,
        content: pickedParsed.content.toString('base64'),
      };
    } catch (error) {
      throw normalizeImapError(error, this.config ?? undefined);
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
      throw normalizeImapError(error, this.config ?? undefined);
    }
  }

  async moveEmails(uids: number[], from = 'INBOX', to: string): Promise<number> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(from);
    try {
      await client.messageMove(uids, to, { uid: true });
      return uids.length;
    } catch (error) {
      throw normalizeImapError(error, this.config ?? undefined);
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
      throw normalizeImapError(error, this.config ?? undefined);
    } finally {
      lock.release();
    }
  }

  async detectTrashFolder(): Promise<string> {
    if (this.trashFolderCache) {
      return this.trashFolderCache;
    }

    const folders = await this.listFolders();

    const bySpecialUse = folders.find((folder) => String(folder.specialUse ?? '').toLowerCase() === '\\trash');
    if (bySpecialUse) {
      this.trashFolderCache = bySpecialUse.path;
      return bySpecialUse.path;
    }

    const common = ['trash', 'deleted messages', 'deleted', 'bin', 'papierkorb', 'gelöscht'];
    const fallback = folders.find((folder) => common.some((name) => folder.path.toLowerCase().includes(name)));

    this.trashFolderCache = fallback?.path ?? 'Trash';
    return this.trashFolderCache;
  }

  async deleteEmails(uids: number[], folder = 'INBOX'): Promise<number> {
    const trash = await this.detectTrashFolder();
    return this.moveEmails(uids, folder, trash);
  }
}
