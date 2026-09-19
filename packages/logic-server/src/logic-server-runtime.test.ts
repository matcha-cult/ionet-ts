import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  BarSkeletonBuilder,
  CmdInfo,
  OnExternalTemplates,
  ActionController,
  ActionMethod,
} from '@nbb-ionet/core-framework';
import {
  ConnectionOwnerOfflineError,
  type ConnectionRegistryStore,
  type RedisOnExternalTransport,
  type RedisRequestReply,
  type ServerRecord,
  type ServerRegistry,
} from '@nbb-ionet/redis';
import { ServerBuilder } from './server-builder.js';
import { detectCrossProcessDuplicateRoutes } from './cross-process-duplicate-check.js';
import { ExternalCommunication } from './external-communication.js';
import { RPC_HANDLER_ON_EXTERNAL } from './protocol.js';

@ActionController(55)
class ProbeAction {
  @ActionMethod(1)
  ping(): string {
    return 'pong';
  }
}

describe('ServerBuilder (RS2 元数据)', () => {
  it('requires a name', () => {
    expect(() => new ServerBuilder().build()).toThrow(/name is required/);
  });

  it('applies defaults and extracts cmdMerges from the skeleton', () => {
    const skeleton = new BarSkeletonBuilder().addAction(ProbeAction).build();
    const record = new ServerBuilder()
      .setName('ProbeLogicServer')
      .setBarSkeleton(skeleton)
      .build();

    expect(record.id).toMatch(/^srv-/);
    expect(record.tag).toBe('ProbeLogicServer');
    expect(record.serverType).toBe('logic');
    expect(record.cmdMerges).toEqual([CmdInfo.of(55, 1).cmdMerge]);
  });

  it('honours explicit id/tag/type/port', () => {
    const record = new ServerBuilder()
      .setId('logic-1')
      .setName('X')
      .setTag('battle')
      .setServerType('external')
      .setPort(9000)
      .build();
    expect(record).toMatchObject({ id: 'logic-1', tag: 'battle', serverType: 'external', port: 9000 });
  });
});

describe('detectCrossProcessDuplicateRoutes (RS8)', () => {
  function fakeRegistry(servers: ServerRecord[]): ServerRegistry {
    return { listAlive: async () => servers } as unknown as ServerRegistry;
  }

  function record(id: string, cmdMerges: number[]): ServerRecord {
    return {
      id,
      name: id,
      tag: id,
      serverType: 'logic',
      cmdMerges,
      startedAt: 1,
      lastHeartbeat: Date.now(),
    };
  }

  it('returns duplicates from the registry cmdMerge regions', async () => {
    const m11 = CmdInfo.of(1, 1).cmdMerge;
    const m12 = CmdInfo.of(1, 2).cmdMerge;
    const m13 = CmdInfo.of(1, 3).cmdMerge;
    const duplicates = await detectCrossProcessDuplicateRoutes(
      fakeRegistry([record('a', [m11, m12]), record('b', [m12, m13])]),
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ cmd: 1, subCmd: 2 });
  });

  it('returns empty when routes are disjoint', async () => {
    const duplicates = await detectCrossProcessDuplicateRoutes(
      fakeRegistry([record('a', [1]), record('b', [2])]),
    );
    expect(duplicates).toEqual([]);
  });
});

describe('ExternalCommunication (RS6)', () => {
  function build(options: {
    lookup?: (userId: string) => string | null;
    alive?: (instanceId: string) => boolean;
  }): {
    communication: ExternalCommunication;
    sent: Array<{ context: unknown; target?: string }>;
    rpcCalls: Array<{ target: string; handler: string }>;
  } {
    const sent: Array<{ context: unknown; target?: string }> = [];
    const rpcCalls: Array<{ target: string; handler: string }> = [];
    const registry = {
      isAlive: async (id: string) => (options.alive ? options.alive(id) : true),
    } as unknown as ServerRegistry;
    const store = {
      lookup: async (userId: string) => (options.lookup ? options.lookup(userId) : null),
    } as unknown as ConnectionRegistryStore;
    const transport = {
      send: async (context: unknown, target?: string) => {
        sent.push({ context, target });
      },
    } as unknown as RedisOnExternalTransport;
    const rpc = {
      send: async (target: string, handler: string) => {
        rpcCalls.push({ target, handler });
      },
      call: async (target: string, handler: string) => {
        rpcCalls.push({ target, handler });
        return true;
      },
    } as unknown as RedisRequestReply;

    return {
      communication: new ExternalCommunication(registry, store, transport, rpc, 'logic-1', 500),
      sent,
      rpcCalls,
    };
  }

  it('forceOffline targets the owning external instance', async () => {
    const { communication, sent } = build({ lookup: () => 'ext-1' });
    expect(await communication.forceOffline('u1')).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].target).toBe('ext-1');
    expect((sent[0].context as { templateId: string }).templateId).toBe(
      OnExternalTemplates.FORCE_OFFLINE,
    );
  });

  it('forceOffline is a no-op (false) when the user has no connection', async () => {
    const { communication, sent } = build({ lookup: () => null });
    expect(await communication.forceOffline('ghost')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('forceOffline throws explicitly when the owner instance is offline', async () => {
    const { communication } = build({ lookup: () => 'dead', alive: () => false });
    await expect(communication.forceOffline('u1')).rejects.toBeInstanceOf(
      ConnectionOwnerOfflineError,
    );
  });

  it('existUser asks the owning instance over RPC', async () => {
    const { communication, rpcCalls } = build({ lookup: () => 'ext-1' });
    expect(await communication.existUser('u1')).toBe(true);
    expect(rpcCalls).toEqual([{ target: 'ext-1', handler: RPC_HANDLER_ON_EXTERNAL }]);
  });

  it('existUser returns false without a connection owner', async () => {
    const { communication, rpcCalls } = build({ lookup: () => null });
    expect(await communication.existUser('ghost')).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});
