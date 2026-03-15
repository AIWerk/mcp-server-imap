#!/usr/bin/env node
// MCP server that provides email tools via IMAP/SMTP

import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { ImapClient } from './imap-client.js';
import { SmtpClient } from './smtp-client.js';

export const toolSchemas = {
  email_list: z.object({
    folder: z.string().default('INBOX').optional(),
    limit: z.number().int().min(1).max(200).default(20).optional(),
    unreadOnly: z.boolean().default(false).optional(),
  }),
  email_read: z.object({
    uid: z.number().int().positive(),
    folder: z.string().default('INBOX').optional(),
    format: z.enum(['text', 'html']).default('text').optional(),
  }),
  email_search: z.object({
    query: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    subject: z.string().optional(),
    since: z.string().datetime().optional(),
    before: z.string().datetime().optional(),
    unread: z.boolean().optional(),
    folder: z.string().default('INBOX').optional(),
  }),
  email_folders: z.object({}),
  email_move: z.object({
    uids: z.array(z.number().int().positive()).min(1),
    from: z.string().default('INBOX').optional(),
    to: z.string(),
  }),
  email_flag: z.object({
    uids: z.array(z.number().int().positive()).min(1),
    action: z.enum(['read', 'unread', 'star', 'unstar']),
    folder: z.string().default('INBOX').optional(),
  }),
  email_delete: z.object({
    uids: z.array(z.number().int().positive()).min(1),
    folder: z.string().default('INBOX').optional(),
  }),
  email_send: z.object({
    to: z.union([z.string(), z.array(z.string()).min(1)]),
    subject: z.string().min(1),
    body: z.string(),
    html: z.boolean().optional(),
    cc: z.union([z.string(), z.array(z.string())]).optional(),
    bcc: z.union([z.string(), z.array(z.string())]).optional(),
    replyTo: z.string().optional(),
    inReplyTo: z.string().optional(),
  }),
};

function toolSuccess(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

export function createServer() {
  const imap = new ImapClient();
  const smtp = new SmtpClient();

  const server = new McpServer({
    name: '@aiwerk/mcp-server-imap',
    version: '1.0.0',
  });

  server.registerTool(
    'email_list',
    {
      description: 'List emails from a folder',
      inputSchema: toolSchemas.email_list.shape,
    },
    async ({ folder = 'INBOX', limit = 20, unreadOnly = false }) => {
      try {
        const messages = await imap.listEmails(folder, limit, unreadOnly);
        return toolSuccess(messages);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'email_read',
    {
      description: 'Read one email including body and attachments metadata',
      inputSchema: toolSchemas.email_read.shape,
    },
    async ({ uid, folder = 'INBOX', format = 'text' }) => {
      try {
        const message = await imap.readEmail(uid, folder, format);
        return toolSuccess(message);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'email_search',
    {
      description: 'Search emails by text/header/date criteria',
      inputSchema: toolSchemas.email_search.shape,
    },
    async (args) => {
      try {
        const { folder = 'INBOX', ...search } = args;
        const messages = await imap.searchEmails(folder, search);
        return toolSuccess(messages);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'email_folders',
    {
      description: 'List all folders and status counters',
      inputSchema: toolSchemas.email_folders.shape,
    },
    async () => {
      try {
        const folders = await imap.listFolders();
        return toolSuccess(folders);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'email_move',
    {
      description: 'Move email UIDs from one folder to another',
      inputSchema: toolSchemas.email_move.shape,
    },
    async ({ uids, from = 'INBOX', to }) => {
      try {
        const moved = await imap.moveEmails(uids, from, to);
        return toolSuccess({ moved });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'email_flag',
    {
      description: 'Set read/star flags on emails',
      inputSchema: toolSchemas.email_flag.shape,
    },
    async ({ uids, action, folder = 'INBOX' }) => {
      try {
        const flagged = await imap.setFlags(uids, action, folder);
        return toolSuccess({ flagged });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'email_delete',
    {
      description: 'Delete emails by moving them to Trash',
      inputSchema: toolSchemas.email_delete.shape,
    },
    async ({ uids, folder = 'INBOX' }) => {
      try {
        const deleted = await imap.deleteEmails(uids, folder);
        return toolSuccess({ deleted });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'email_send',
    {
      description: 'Send an email via SMTP',
      inputSchema: toolSchemas.email_send.shape,
    },
    async (input) => {
      try {
        const sendEnabled = ['1', 'true', 'yes', 'on'].includes(
          (process.env.SMTP_SEND_ENABLED ?? '').toLowerCase()
        );
        if (!sendEnabled) {
          return toolError(
            new Error('Email sending is disabled. Set SMTP_SEND_ENABLED=true to enable.')
          );
        }
        const result = await smtp.sendMail(input);
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return {
    server,
    close: async () => {
      await imap.close();
      await server.close();
    },
  };
}

async function main() {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
