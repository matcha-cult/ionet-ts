import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractMailAction } from './abstract-mail-action.js';
import type { Mail, UserId } from '../types/index.js';

class TestMailAction extends AbstractMailAction {
  events: string[] = [];
  size: number;

  constructor(size = 2) {
    super();
    this.size = size;
  }

  protected async getMailboxSize(userId: UserId): Promise<number> {
    return this.size;
  }

  protected async onMailReceived(userId: UserId, mail: Mail): Promise<void> {
    this.events.push('recv:' + mail.title);
  }

  protected async onAttachmentClaimed(userId: UserId, mail: Mail, items: unknown[]): Promise<void> {
    this.events.push('claim:' + items.length);
  }
}

describe('AbstractMailAction', () => {
  let mailAction: TestMailAction;

  beforeEach(() => {
    mailAction = new TestMailAction();
  });

  it('sends and lists mail newest first', async () => {
    const first = await mailAction.send('u1', { sender: 'system', title: 'A', content: '' });
    const second = await mailAction.send('u1', { sender: 'system', title: 'B', content: '' });

    const list = await mailAction.list('u1');
    expect(list.map((mail) => mail.title)).toEqual(['B', 'A']);
    expect(list[0].id).toBe(second.id);
    expect(first.id).toBeTruthy();
  });

  it('enforces mailbox capacity', async () => {
    await mailAction.send('u1', { sender: 'system', title: 'A', content: '' });
    await mailAction.send('u1', { sender: 'system', title: 'B', content: '' });

    await expect(mailAction.send('u1', { sender: 'system', title: 'C', content: '' })).rejects.toThrow(
      'Mailbox is full',
    );
  });

  it('marks mail read and claims attachments exactly once', async () => {
    const mail = await mailAction.send('u1', {
      sender: 'system',
      title: 'Reward',
      content: '',
      attachments: [{ itemId: 'gold', count: 100 }],
    });

    const read = await mailAction.read('u1', mail.id);
    expect(read?.isRead).toBe(true);

    const items = await mailAction.claimAttachment('u1', mail.id);
    expect(items).toEqual([{ itemId: 'gold', count: 100 }]);
    await expect(mailAction.claimAttachment('u1', mail.id)).rejects.toThrow(
      'Attachments already claimed',
    );
  });

  it('filters expired mail out of list and capacity', async () => {
    await mailAction.send('u1', {
      sender: 'system',
      title: 'Expired',
      content: '',
      expiresAt: Date.now() - 1000,
    });
    await mailAction.send('u1', { sender: 'system', title: 'Now', content: '' });

    const list = await mailAction.list('u1');
    expect(list.map((mail) => mail.title)).toEqual(['Now']);
  });

  it('fires mail hooks', async () => {
    const mail = await mailAction.send('u1', {
      sender: 'system',
      title: 'Reward',
      content: '',
      attachments: [{ itemId: 'gold', count: 100 }],
    });
    await mailAction.claimAttachment('u1', mail.id);

    expect(mailAction.events).toEqual(['recv:Reward', 'claim:1']);
  });
});
