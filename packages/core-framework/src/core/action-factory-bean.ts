export interface ActionFactoryBean<T = object> {
  getBean(ActionClass: new (...args: any[]) => T): T;
}

export class DefaultActionFactoryBean<T = object> implements ActionFactoryBean<T> {
  private readonly instances = new Map<Function, T>();

  getBean(ActionClass: new (...args: any[]) => T): T {
    let instance = this.instances.get(ActionClass);
    if (!instance) {
      instance = new ActionClass();
      this.instances.set(ActionClass, instance);
    }
    return instance;
  }

  clear(): void {
    this.instances.clear();
  }
}
