import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { RedisClient, RedisPubSub } from '@nbb-ionet/redis';
import {
  type ClientMessage, type ServerMessage, type GameState,
  type RoundState, type Choice, type RoundOutcome, type PlayerInfo,
  CHOICES, MATCH_TOTAL_ROUNDS, MATCH_WIN_TARGET, R, CH, evaluateRound,
} from './types.js';

interface LocalPlayer {
  id: string;
  name: string;
  ws: WebSocket;
}

export interface GameServerOptions {
  port: number;
  host?: string;
  redisClient: RedisClient;
  pubSub: RedisPubSub;
}

// Atomic: create game only if not exists
const CREATE_GAME_LUA = `
  if redis.call('exists', KEYS[1]) == 0 then
    redis.call('set', KEYS[1], ARGV[1])
    return 1
  end
  return 0
`;

// Atomic: claim match coordination (only one instance creates the game)
const CLAIM_MATCH_LUA = `
  return redis.call('set', KEYS[1], ARGV[1], 'NX', 'PX', 10000)
`;

export class GameServer {
  private wss: WebSocketServer | null = null;
  private readonly localPlayers = new Map<WebSocket, LocalPlayer>();
  private readonly playerSockets = new Map<string, WebSocket>();
  private readonly games = new Map<string, GameState>();
  private readonly localQueue: string[] = [];
  private started = false;

  constructor(private readonly opts: GameServerOptions) {}

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.opts.port, host: this.opts.host ?? '0.0.0.0' });
    this.wss.on('connection', (ws) => this.handleConnection(ws));

    await this.opts.pubSub.subscribe(CH.match, (_ch, msg) => {
      void this.onMatchOffer(msg.payload as { from: string; playerId: string; playerName: string });
    });

    await this.opts.pubSub.subscribe(CH.notify, (_ch, msg) => {
      const p = msg.payload as { playerId: string; message: ServerMessage };
      this.sendToLocal(p.playerId, p.message);
    });

    return new Promise((resolve) => {
      this.wss!.on('listening', () => {
        this.started = true;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.opts.pubSub.unsubscribe(CH.match);
    await this.opts.pubSub.unsubscribe(CH.notify);

    for (const [ws, player] of this.localPlayers) {
      ws.close();
      await this.opts.redisClient.getClient().del(R.playerInstance(player.id));
    }
    for (const q of this.localQueue) {
      await this.opts.redisClient.getClient().lrem(R.queue(this.instanceId()), 0, q);
    }

    this.wss?.close();
    this.started = false;
  }

  // ── Connection handling ──

  private handleConnection(ws: WebSocket): void {
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        this.send(ws, { type: 'error', message: 'Invalid message format' });
        return;
      }
      void this.handleMessage(ws, msg);
    });
    ws.on('close', () => this.handleDisconnect(ws));
  }

  private async handleMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'join':    return this.handleJoin(ws, msg.playerName);
      case 'quit':    return this.handleQuit(ws);
      case 'move':    return this.handleMove(ws, msg.choice);
      case 'next':    return this.handleNext(ws);
      default:        this.send(ws, { type: 'error', message: `Unknown type: ${(msg as { type: string }).type}` });
    }
  }

  // ── Join / Matchmaking ──

  private async handleJoin(ws: WebSocket, playerName: string): Promise<void> {
    const playerId = randomUUID();
    const player: LocalPlayer = { id: playerId, name: playerName, ws };
    this.localPlayers.set(ws, player);
    this.playerSockets.set(playerId, ws);

    await this.opts.redisClient.getClient().set(R.playerInstance(playerId), this.instanceId());
    await this.opts.redisClient.getClient().lpush(R.queue(this.instanceId()), playerId);
    this.localQueue.push(playerId);

    this.send(ws, { type: 'queued' });

    await this.opts.pubSub.publish(CH.match, {
      from: this.instanceId(),
      playerId,
      playerName,
    });
  }

  private async onMatchOffer(offer: { from: string; playerId: string; playerName: string }): Promise<void> {
    if (offer.from === this.instanceId()) {
      // Same instance: try to match with a different local player
      for (const localId of [...this.localQueue]) {
        if (localId === offer.playerId) continue;
        this.localQueue.splice(this.localQueue.indexOf(localId), 1);
        await this.opts.redisClient.getClient().lrem(R.queue(this.instanceId()), 1, localId);
        const localPlayer = this.findLocalPlayer(localId);
        if (!localPlayer) continue;
        const opponent = { id: offer.playerId, name: offer.playerName };
        await this.createAndNotify(localPlayer, opponent);
        return;
      }
      return;
    }

    // Cross-instance: try to match with any local queued player
    if (this.localQueue.length === 0) return;

    const localId = this.localQueue.shift()!;
    await this.opts.redisClient.getClient().lrem(R.queue(this.instanceId()), 1, localId);

    const localPlayer = this.findLocalPlayer(localId);
    if (!localPlayer) return;

    // Use coordination key to ensure only one instance creates the game
    const coordKey = R.matchCoord(localId, offer.playerId);
    const claimed = await this.opts.redisClient.getClient().eval(CLAIM_MATCH_LUA, 1, coordKey, this.instanceId()) as string | null;

    if (claimed !== 'OK') {
      return; // Other instance will handle it
    }

    const opponent: PlayerInfo = { id: offer.playerId, name: offer.playerName };
    const result = await this.createGame(localPlayer.id, localPlayer.name, opponent);
    if (!result) return;

    // This instance created the game → send notifications to both
    const state = this.games.get(result.gameId)!;

    // Send matched first, then game_start
    this.send(localPlayer.ws, { type: 'matched', gameId: state.id, opponentName: opponent.name });
    await this.notifyRemote(opponent.id, { type: 'matched', gameId: state.id, opponentName: localPlayer.name });

    const startMsg = this.buildStartMsg(state, 1);
    this.send(localPlayer.ws, { ...startMsg, opponentName: opponent.name });
    await this.notifyRemote(opponent.id, { ...startMsg, opponentName: localPlayer.name });
  }

  // ── Move handling ──

  private async handleMove(ws: WebSocket, choice: Choice): Promise<void> {
    const player = this.localPlayers.get(ws);
    if (!player) { this.send(ws, { type: 'error', message: 'Not joined' }); return; }

    const gameId = await this.opts.redisClient.getClient().get(R.playerGame(player.id));
    if (!gameId) { this.send(ws, { type: 'error', message: 'No active game' }); return; }

    // Always load from Redis to get the latest state
    const stateJson = await this.opts.redisClient.getClient().get(R.game(gameId));
    if (!stateJson) { this.send(ws, { type: 'error', message: 'Game state lost' }); return; }
    const state = JSON.parse(stateJson) as GameState;
    this.games.set(gameId, state); // update local cache

    const roundIdx = state.rounds.length - 1;
    const round = state.rounds[roundIdx];
    if (!round) { this.send(ws, { type: 'error', message: 'Invalid round' }); return; }

    const isP1 = state.p1.id === player.id;
    const mySlot = isP1 ? 'p1Choice' : 'p2Choice';
    if (round[mySlot] !== null) {
      this.send(ws, { type: 'error', message: 'Already chose for this round' });
      return;
    }
    if (!CHOICES.includes(choice)) {
      this.send(ws, { type: 'error', message: `Invalid choice: ${choice}` });
      return;
    }

    round[mySlot] = choice;
    await this.saveGame(state);
    this.send(ws, { type: 'move_ok', gameId, round: roundIdx + 1 });

    if (round.p1Choice !== null && round.p2Choice !== null) {
      await this.resolveRound(state, roundIdx);
    }
  }

  private async resolveRound(state: GameState, roundIdx: number): Promise<void> {
    const round = state.rounds[roundIdx];
    const outcome = evaluateRound(round.p1Choice!, round.p2Choice!);

    if (outcome === 'p1') state.scores[0]++;
    else if (outcome === 'p2') state.scores[1]++;

    const gameOver = state.scores[0] >= state.winTarget || state.scores[1] >= state.winTarget
      || state.rounds.length >= state.totalRounds;

    console.log(`  [${this.instanceId().slice(0, 8)}] resolveRound: round=${roundIdx + 1} gameOver=${gameOver} roundsBefore=${state.rounds.length}`);

    if (!gameOver) {
      state.rounds.push({ p1Choice: null, p2Choice: null });
      console.log(`  [${this.instanceId().slice(0, 8)}] added new round, total=${state.rounds.length}`);
    }

    await this.saveGame(state);
    console.log(`  [${this.instanceId().slice(0, 8)}] saved game state to Redis`);

    const base = {
      gameId: state.id,
      round: roundIdx + 1,
      scores: [...state.scores] as [number, number],
    };

    const p1Msg: ServerMessage = {
      type: 'round_result', ...base,
      yourChoice: round.p1Choice!, opponentChoice: round.p2Choice!,
      outcome: outcome === 'p1' ? 'win' : outcome === 'p2' ? 'lose' : 'draw',
    };
    const p2Msg: ServerMessage = {
      type: 'round_result', ...base,
      yourChoice: round.p2Choice!, opponentChoice: round.p1Choice!,
      outcome: outcome === 'p2' ? 'win' : outcome === 'p1' ? 'lose' : 'draw',
    };

    await this.sendToPlayer(state.p1.id, p1Msg);
    await this.sendToPlayer(state.p2.id, p2Msg);

    if (gameOver) {
      await this.endGame(state);
    }
  }

  private async endGame(state: GameState): Promise<void> {
    const [s1, s2] = state.scores;
    const p1Result = s1 > s2 ? 'win' : s1 < s2 ? 'lose' : 'draw';
    const p2Result = s1 > s2 ? 'lose' : s1 < s2 ? 'win' : 'draw';

    await this.sendToPlayer(state.p1.id, {
      type: 'game_over', gameId: state.id, result: p1Result,
      yourScore: s1, opponentScore: s2, rounds: state.rounds.length,
    });
    await this.sendToPlayer(state.p2.id, {
      type: 'game_over', gameId: state.id, result: p2Result,
      yourScore: s2, opponentScore: s1, rounds: state.rounds.length,
    });

    await this.cleanup(state);
  }

  // ── Next round (explicit ready signal) ──

  private async handleNext(ws: WebSocket): Promise<void> {
    const player = this.localPlayers.get(ws);
    if (!player) return;

    console.log(`  [${this.instanceId().slice(0, 8)}] handleNext: player=${player.name}`);

    const gameId = await this.opts.redisClient.getClient().get(R.playerGame(player.id));
    if (!gameId) {
      console.log(`  [${this.instanceId().slice(0, 8)}] handleNext: no gameId for player`);
      return;
    }

    // Always load from Redis to get the latest state (local cache may be stale)
    const stateJson = await this.opts.redisClient.getClient().get(R.game(gameId));
    if (!stateJson) {
      console.log(`  [${this.instanceId().slice(0, 8)}] handleNext: game state not in Redis`);
      return;
    }
    const state = JSON.parse(stateJson) as GameState;
    this.games.set(gameId, state); // update local cache

    const round = state.rounds[state.rounds.length - 1];
    const roundEmpty = !round || (round.p1Choice === null && round.p2Choice === null);
    console.log(`  [${this.instanceId().slice(0, 8)}] handleNext: loadedFromRedis=true totalRounds=${state.rounds.length} lastRoundEmpty=${roundEmpty}`);

    if (roundEmpty) {
      const roundNum = state.rounds.length;
      const opponentName = state.p1.id === player.id ? state.p2.name : state.p1.name;
      console.log(`  [${this.instanceId().slice(0, 8)}] handleNext: sending game_start round=${roundNum} to ${player.name}`);
      this.send(ws, { ...this.buildStartMsg(state, roundNum), opponentName });
    } else {
      console.log(`  [${this.instanceId().slice(0, 8)}] handleNext: round not empty, not sending game_start`);
    }
  }

  // ── Quit ──

  private async handleQuit(ws: WebSocket): Promise<void> {
    const player = this.localPlayers.get(ws);
    if (!player) return;

    const gameId = await this.opts.redisClient.getClient().get(R.playerGame(player.id));
    if (gameId) {
      const state = this.games.get(gameId);
      if (state) {
        const opponentId = state.p1.id === player.id ? state.p2.id : state.p1.id;
        await this.sendToPlayer(opponentId, { type: 'opponent_quit', gameId });
        await this.cleanup(state);
      }
    }

    const qi = this.localQueue.indexOf(player.id);
    if (qi >= 0) {
      this.localQueue.splice(qi, 1);
      await this.opts.redisClient.getClient().lrem(R.queue(this.instanceId()), 0, player.id);
    }

    await this.opts.redisClient.getClient().del(R.playerInstance(player.id));
    this.localPlayers.delete(ws);
    this.playerSockets.delete(player.id);
    ws.close();
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const player = this.localPlayers.get(ws);
    if (!player) return;

    const gameId = await this.opts.redisClient.getClient().get(R.playerGame(player.id));
    if (gameId) {
      const state = this.games.get(gameId);
      if (state) {
        const opponentId = state.p1.id === player.id ? state.p2.id : state.p1.id;
        await this.sendToPlayer(opponentId, { type: 'opponent_quit', gameId });
        await this.cleanup(state);
      }
    }

    const qi = this.localQueue.indexOf(player.id);
    if (qi >= 0) {
      this.localQueue.splice(qi, 1);
      await this.opts.redisClient.getClient().lrem(R.queue(this.instanceId()), 0, player.id);
    }

    await this.opts.redisClient.getClient().del(R.playerInstance(player.id));
    this.localPlayers.delete(ws);
    this.playerSockets.delete(player.id);
  }

  // ── Helpers ──

  private async createGame(p1Id: string, p1Name: string, p2: PlayerInfo): Promise<{ gameId: string } | null> {
    const gameId = randomUUID();
    const state: GameState = {
      id: gameId,
      p1: { id: p1Id, name: p1Name },
      p2,
      rounds: [{ p1Choice: null, p2Choice: null }],
      scores: [0, 0],
      totalRounds: MATCH_TOTAL_ROUNDS,
      winTarget: MATCH_WIN_TARGET,
    };

    const client = this.opts.redisClient.getClient();
    const created = await client.eval(CREATE_GAME_LUA, 1, R.game(gameId), JSON.stringify(state)) as number;
    if (created !== 1) return null;

    await client.set(R.playerGame(p1Id), gameId);
    await client.set(R.playerGame(p2.id), gameId);
    await client.set(R.playerInstance(p2.id), p2.id); // placeholder for remote

    this.games.set(gameId, state);
    return { gameId };
  }

  private async createAndNotify(localPlayer: LocalPlayer, opponent: PlayerInfo): Promise<void> {
    const result = await this.createGame(localPlayer.id, localPlayer.name, opponent);
    if (!result) return;

    const state = this.games.get(result.gameId)!;

    // Send matched first, then game_start
    this.send(localPlayer.ws, { type: 'matched', gameId: state.id, opponentName: opponent.name });
    await this.notifyRemote(opponent.id, { type: 'matched', gameId: state.id, opponentName: localPlayer.name });

    const startMsg = this.buildStartMsg(state, 1);
    this.send(localPlayer.ws, { ...startMsg, opponentName: opponent.name });
    await this.notifyRemote(opponent.id, { ...startMsg, opponentName: localPlayer.name });
  }

  private buildStartMsg(state: GameState, round: number): ServerMessage {
    return {
      type: 'game_start',
      gameId: state.id,
      opponentName: '', // caller fills in
      round,
      totalRounds: state.totalRounds,
      choices: CHOICES,
    };
  }

  private async saveGame(state: GameState): Promise<void> {
    await this.opts.redisClient.getClient().set(R.game(state.id), JSON.stringify(state));
  }

  private async cleanup(state: GameState): Promise<void> {
    const client = this.opts.redisClient.getClient();
    this.games.delete(state.id);
    await client.del(R.game(state.id));
    await client.del(R.playerGame(state.p1.id));
    await client.del(R.playerGame(state.p2.id));
    await client.del(R.playerInstance(state.p1.id));
    await client.del(R.playerInstance(state.p2.id));
  }

  private async sendToPlayer(playerId: string, message: ServerMessage): Promise<void> {
    const ws = this.playerSockets.get(playerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.send(ws, message);
      return;
    }
    await this.notifyRemote(playerId, message);
  }

  private async notifyRemote(playerId: string, message: ServerMessage): Promise<void> {
    await this.opts.pubSub.publish(CH.notify, { playerId, message });
  }

  private sendToLocal(playerId: string, message: ServerMessage): void {
    const ws = this.playerSockets.get(playerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.send(ws, message);
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  private findLocalPlayer(playerId: string): LocalPlayer | undefined {
    const ws = this.playerSockets.get(playerId);
    return ws ? this.localPlayers.get(ws) : undefined;
  }

  private instanceId(): string {
    return this.opts.redisClient.getInstanceId();
  }
}
