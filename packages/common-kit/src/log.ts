export const IonetLogName = {
  CommonStdout: 'CommonStdout',
  ExternalTopic: 'ExternalTopic',
  MsgTransferTopic: 'MsgTransferTopic',
  ConnectionTopic: 'ConnectionTopic',
} as const;

export type LogTopic = (typeof IonetLogName)[keyof typeof IonetLogName];
