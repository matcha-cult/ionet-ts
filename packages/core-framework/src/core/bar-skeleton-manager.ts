import { BarSkeleton } from './bar-skeleton.js';

export class BarSkeletonManager {
  private static instance: BarSkeletonManager | null = null;
  private skeleton: BarSkeleton | null = null;

  static getInstance(): BarSkeletonManager {
    if (!BarSkeletonManager.instance) {
      BarSkeletonManager.instance = new BarSkeletonManager();
    }
    return BarSkeletonManager.instance;
  }

  static resetInstance(): void {
    BarSkeletonManager.instance = null;
  }

  setSkeleton(skeleton: BarSkeleton): void {
    this.skeleton = skeleton;
  }

  getSkeleton(): BarSkeleton {
    if (!this.skeleton) {
      throw new Error('BarSkeleton not initialized. Call setSkeleton() first.');
    }
    return this.skeleton;
  }

  hasSkeleton(): boolean {
    return this.skeleton !== null;
  }
}
