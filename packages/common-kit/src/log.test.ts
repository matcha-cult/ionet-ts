import { describe, it, expect } from 'vitest';
import { IonetLogName } from './log.js';

describe('IonetLogName', () => {
  it('should have expected topic constants', () => {
    expect(IonetLogName.CommonStdout).toBe('CommonStdout');
    expect(IonetLogName.ExternalTopic).toBe('ExternalTopic');
    expect(IonetLogName.MsgTransferTopic).toBe('MsgTransferTopic');
    expect(IonetLogName.ConnectionTopic).toBe('ConnectionTopic');
  });
});
