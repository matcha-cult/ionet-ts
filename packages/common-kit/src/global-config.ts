export interface BarSkeletonSetting {
  devMode: boolean;
}

export interface CoreGlobalConfigShape {
  setting: BarSkeletonSetting;
  netId: number;
  netPubName: string;
  timeoutMillis: number;
  cleanFrequency: number;
  devMode: boolean;
}

export const CoreGlobalConfig: CoreGlobalConfigShape = {
  setting: {
    devMode: false,
  },
  netId: Math.floor(Math.random() * (Number.MAX_SAFE_INTEGER - 1000)) + 1000,
  netPubName: '',
  timeoutMillis: 3000,
  cleanFrequency: 10_000,
  devMode: false,
};

CoreGlobalConfig.netPubName = String(CoreGlobalConfig.netId);

export function setNetId(netId: number): void {
  if (netId < 1000) {
    throw new RangeError('netId must be > 1000');
  }
  CoreGlobalConfig.netId = netId;
  CoreGlobalConfig.netPubName = String(netId);
}

export function getFutureTimeoutMillis(): number {
  return CoreGlobalConfig.timeoutMillis + 200;
}
