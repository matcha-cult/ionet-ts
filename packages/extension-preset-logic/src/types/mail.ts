import type { UserId } from './common.js';

export interface MailAttachment {
  itemId: string;
  count: number;
}

export interface Mail {
  id: string;
  /** 'system' or the sending UserId. */
  sender: string;
  recipientId: UserId;
  title: string;
  content: string;
  attachments: MailAttachment[];
  isRead: boolean;
  claimed: boolean;
  sentAt: number;
  expiresAt?: number;
}
