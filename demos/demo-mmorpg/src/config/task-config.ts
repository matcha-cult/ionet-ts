export interface TaskConfig {
  taskType: string;
  duration: number; // milliseconds
  reward: {
    itemId: string;
    count: number;
  };
}

export const TASK_CONFIGS: Record<string, TaskConfig> = {
  wood: {
    taskType: 'wood',
    duration: 3300, // 3.3 seconds
    reward: {
      itemId: 'wood',
      count: 1,
    },
  },
  cake: {
    taskType: 'cake',
    duration: 4900, // 4.9 seconds
    reward: {
      itemId: 'cake',
      count: 1,
    },
  },
  iron: {
    taskType: 'iron',
    duration: 6000, // 6 seconds
    reward: {
      itemId: 'iron',
      count: 1,
    },
  },
};

export function getTaskConfig(taskType: string): TaskConfig | undefined {
  return TASK_CONFIGS[taskType];
}
