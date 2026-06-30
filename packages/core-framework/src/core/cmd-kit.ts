export const CMD_MERGE_SHIFT = 16;
const SUB_CMD_MASK = 0xFFFF;

export function merge(cmd: number, subCmd: number): number {
  return (cmd << CMD_MERGE_SHIFT) | subCmd;
}

export function getCmd(cmdMerge: number): number {
  return cmdMerge >>> CMD_MERGE_SHIFT;
}

export function getSubCmd(cmdMerge: number): number {
  return cmdMerge & SUB_CMD_MASK;
}

export function toString(cmdMerge: number): string {
  return `[cmd:${getCmd(cmdMerge)}-${getSubCmd(cmdMerge)} ${cmdMerge}]`;
}

export function toSimpleString(cmd: number, subCmd: number): string {
  return `${cmd}-${subCmd}`;
}
