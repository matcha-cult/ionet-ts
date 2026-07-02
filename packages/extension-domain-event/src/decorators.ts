import 'reflect-metadata';

const DOMAIN_EVENT_KEY = Symbol('domain:event');

export interface DomainEventMetadata {
  timestamp: number;
  source?: string;
  correlationId?: string;
}

export interface DomainEventOptions {
  type: string;
}

export function DomainEvent(options: DomainEventOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(DOMAIN_EVENT_KEY, {
      type: options.type,
    }, target);
  };
}

export function getDomainEventType(target: Function): string {
  const meta = Reflect.getMetadata(DOMAIN_EVENT_KEY, target);
  return meta?.type ?? target.name;
}

export abstract class DomainEventBase {
  readonly metadata: DomainEventMetadata;

  constructor() {
    this.metadata = {
      timestamp: Date.now(),
      source: this.constructor.name,
    };
  }
}
