import { randomUUID } from 'node:crypto';
import type { Mail, MailAttachment, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';

export interface SendMailInput {
  sender: string;
  title: string;
  content: string;
  attachments?: MailAttachment[];
  expiresAt?: number;
}

/**
 * Template method for mailbox management: capacity checks, expiry cleanup, and
 * attachment claiming. Concrete actions implement capacity and (optionally)
 * persistence via load/save hooks.
 */
export abstract class AbstractMailAction {
  private readonly inboxes = new Map<string, Mail[]>();
  private lastSentAt = 0;

  /** Maximum number of active (non-expired) mails a mailbox can hold. */
  protected abstract getMailboxSize(userId: UserId): Promise<number>;

  /** Invoked after a mail is delivered. Default no-op. */
  protected onMailReceived(userId: UserId, mail: Mail): void | Promise<void> {
    return undefined;
  }

  /** Invoked after attachments are claimed. Default no-op. */
  protected onAttachmentClaimed(
    userId: UserId,
    mail: Mail,
    items: MailAttachment[],
  ): void | Promise<void> {
    return undefined;
  }

  /** Load persisted inbox. Defaults to the in-memory store. */
  protected async loadInbox(userId: UserId): Promise<ReadonlyArray<Mail>> {
    return this.inboxes.get(userIdKey(userId)) ?? [];
  }

  /** Persist inbox. Defaults to the in-memory store. */
  protected async saveInbox(userId: UserId, inbox: ReadonlyArray<Mail>): Promise<void> {
    this.inboxes.set(userIdKey(userId), [...inbox]);
  }

  /** Generate a mail id. Override for idempotent/snowflake ids. */
  protected generateMailId(): string {
    return randomUUID();
  }

  async send(recipientId: UserId, input: SendMailInput): Promise<Mail> {
    const inbox = (await this.loadInbox(recipientId)).filter((mail) => this.isActive(mail));
    const size = await this.getMailboxSize(recipientId);
    if (inbox.length >= size) {
      throw new Error('Mailbox is full');
    }

    const sentAt = Math.max(Date.now(), this.lastSentAt + 1);
    this.lastSentAt = sentAt;

    const mail: Mail = {
      id: this.generateMailId(),
      sender: input.sender,
      recipientId,
      title: input.title,
      content: input.content,
      attachments: input.attachments ?? [],
      isRead: false,
      claimed: false,
      sentAt,
      expiresAt: input.expiresAt,
    };

    await this.saveInbox(recipientId, [...inbox, mail]);
    await this.onMailReceived(recipientId, mail);
    return mail;
  }

  /** List active mails, newest first. */
  async list(userId: UserId): Promise<Mail[]> {
    const inbox = await this.loadInbox(userId);
    return inbox
      .filter((mail) => this.isActive(mail))
      .sort((a, b) => b.sentAt - a.sentAt);
  }

  async read(userId: UserId, mailId: string): Promise<Mail | null> {
    const inbox = [...(await this.loadInbox(userId))];
    const mail = inbox.find((candidate) => candidate.id === mailId && this.isActive(candidate));
    if (!mail) return null;
    mail.isRead = true;
    await this.saveInbox(userId, inbox);
    return mail;
  }

  /** Claim a mail's attachments exactly once; returns them. */
  async claimAttachment(userId: UserId, mailId: string): Promise<MailAttachment[]> {
    const inbox = [...(await this.loadInbox(userId))];
    const mail = inbox.find((candidate) => candidate.id === mailId && this.isActive(candidate));
    if (!mail) {
      throw new Error('Mail not found');
    }
    if (mail.claimed) {
      throw new Error('Attachments already claimed');
    }
    mail.claimed = true;
    mail.isRead = true;
    await this.saveInbox(userId, inbox);
    await this.onAttachmentClaimed(userId, mail, mail.attachments);
    return mail.attachments;
  }

  private isActive(mail: Mail): boolean {
    return mail.expiresAt === undefined || mail.expiresAt > Date.now();
  }
}
