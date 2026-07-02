export const FlowContextKeys = {
  userId: 'userId',
  cmdInfo: 'cmdInfo',
  cmdMerge: 'cmdMerge',
  request: 'request',
  response: 'response',
  methodResult: 'methodResult',
  errorCode: 'errorCode',
  errorMessage: 'errorMessage',
  nanoTime: 'nanoTime',
  session: 'session',
  serverInfo: 'serverInfo',
  attachments: 'attachments',
} as const;

export type FlowContextKey = (typeof FlowContextKeys)[keyof typeof FlowContextKeys];
