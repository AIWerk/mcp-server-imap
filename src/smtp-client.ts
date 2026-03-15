import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

export type SmtpConfig = {
  host?: string;
  port: number;
  user?: string;
  pass?: string;
  tls: boolean;
  from?: string;
};

export type EmailSendParams = {
  to: string | string[];
  subject: string;
  body: string;
  html?: boolean;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  inReplyTo?: string;
  references?: string | string[];
};

import { parseBool } from './utils.js';

export function readSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const imapHost = env.IMAP_HOST?.trim();
  const imapUser = env.IMAP_USER?.trim();
  const imapPass = env.IMAP_PASS;

  const host = env.SMTP_HOST?.trim() || imapHost;
  const user = env.SMTP_USER?.trim() || imapUser;
  const pass = env.SMTP_PASS ?? imapPass;
  const from = env.SMTP_FROM?.trim() || imapUser;

  const port = Number(env.SMTP_PORT ?? 465);

  return {
    host,
    user,
    pass,
    from,
    port: Number.isFinite(port) ? port : 465,
    tls: parseBool(env.SMTP_TLS, true),
  };
}

export class SmtpClient {
  private readonly config: SmtpConfig;
  private transporter: nodemailer.Transporter | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.config = readSmtpConfig(env);
  }

  private getTransporter(): nodemailer.Transporter {
    if (!this.config.host) {
      throw new Error('SMTP not configured');
    }

    if (!this.transporter) {
      const transportConfig: SMTPTransport.Options = {
        host: this.config.host,
        port: this.config.port,
        secure: this.config.tls,
        auth:
          this.config.user && this.config.pass
            ? {
                user: this.config.user,
                pass: this.config.pass,
              }
            : undefined,
      };

      this.transporter = nodemailer.createTransport(transportConfig);
    }

    return this.transporter;
  }

  async sendMail(params: EmailSendParams): Promise<{ messageId: string; accepted: string[] }> {
    const info = await this.getTransporter().sendMail({
      from: this.config.from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      text: params.html ? undefined : params.body,
      html: params.html ? params.body : undefined,
      replyTo: params.replyTo,
      inReplyTo: params.inReplyTo,
      references: params.references,
    });

    return {
      messageId: info.messageId,
      accepted: (info.accepted ?? []).map((entry: unknown) => String(entry)),
    };
  }

  async close(): Promise<void> {
    if (!this.transporter) return;
    this.transporter.close();
    this.transporter = null;
  }
}
