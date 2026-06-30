import { WebSocket } from 'ws';
import {
  type ClientMessage, type ServerMessage, type Choice,
  CHOICES,
} from './types.js';

class GameClient {
  private ws: WebSocket;
  private readonly name: string;
  private readonly handlers = new Map<string, Array<(msg: ServerMessage) => void>>();

  constructor(url: string, name: string) {
    this.name = name;
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      const list = this.handlers.get(msg.type);
      if (list) {
        const handler = list.shift()!;
        if (list.length === 0) this.handlers.delete(msg.type);
        handler(msg);
      }
    });
  }

  private waitFor(type: string): Promise<ServerMessage> {
    return new Promise((resolve) => {
      let list = this.handlers.get(type);
      if (!list) { list = []; this.handlers.set(type, list); }
      list.push((msg) => resolve(msg));
    });
  }

  private send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  async join(): Promise<{ opponentName: string; gameId: string; totalRounds: number }> {
    const matched = this.waitFor('matched');
    const gameStart = this.waitFor('game_start');
    this.send({ type: 'join', playerName: this.name });

    const queued = await this.waitFor('queued');
    log(this.name, 'joined queue');

    const matchMsg = await matched as Extract<ServerMessage, { type: 'matched' }>;
    log(this.name, `matched! gameId=${matchMsg.gameId.slice(0, 8)} opponent=${matchMsg.opponentName}`);

    const startMsg = await gameStart as Extract<ServerMessage, { type: 'game_start' }>;
    log(this.name, `game start! round ${startMsg.round}/${startMsg.totalRounds} choices=${startMsg.choices.join('/')}`);

    return { opponentName: matchMsg.opponentName, gameId: matchMsg.gameId, totalRounds: startMsg.totalRounds };
  }

  async waitForStart(): Promise<void> {
    const msg = await this.waitFor('game_start') as Extract<ServerMessage, { type: 'game_start' }>;
    log(this.name, `game start! round ${msg.round}/${msg.totalRounds} choices=${msg.choices.join('/')}`);
  }

  async makeMove(choice: Choice): Promise<void> {
    const ok = this.waitFor('move_ok');
    this.send({ type: 'move', choice });
    await ok;
    log(this.name, `chose ${choice} ✓`);
  }

  async requestNext(): Promise<void> {
    log(this.name, `sending next...`);
    this.send({ type: 'next' });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout waiting for game_start')), 3000));
    try {
      await Promise.race([this.waitFor('game_start'), timeout]);
      log(this.name, `next round ready`);
    } catch (e) {
      log(this.name, `ERROR: ${(e as Error).message}`);
      throw e;
    }
  }

  async waitForRoundResult(): Promise<{ yourChoice: Choice; opponentChoice: Choice; outcome: string; scores: [number, number] }> {
    const msg = await this.waitFor('round_result') as Extract<ServerMessage, { type: 'round_result' }>;
    const outcomeLabel = msg.outcome === 'win' ? 'WIN' : msg.outcome === 'lose' ? 'LOSE' : 'DRAW';
    log(this.name, `round ${msg.round}: ${msg.yourChoice} vs ${msg.opponentChoice} → ${outcomeLabel}  scores=[${msg.scores.join(',')}]`);
    return { yourChoice: msg.yourChoice, opponentChoice: msg.opponentChoice, outcome: msg.outcome, scores: msg.scores };
  }

  async waitForGameOver(): Promise<void> {
    const msg = await this.waitFor('game_over') as Extract<ServerMessage, { type: 'game_over' }>;
    log(this.name, `GAME OVER: ${msg.result.toUpperCase()}  score ${msg.yourScore}-${msg.opponentScore}  (${msg.rounds} rounds)`);
  }

  quit(): void {
    this.send({ type: 'quit' });
    setTimeout(() => this.ws.close(), 200);
  }

  waitForClose(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
      this.ws.on('close', resolve);
    });
  }
}

function log(who: string, msg: string): void {
  const time = new Date().toLocaleTimeString();
  console.log(`  [${time}] ${who}: ${msg}`);
}

function randomChoice(): Choice {
  return CHOICES[Math.floor(Math.random() * CHOICES.length)];
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('\n=== Rock Paper Scissors — Cross-Instance Demo ===\n');
  console.log('Player Alice → Instance 0 (port 9090)');
  console.log('Player Bob   → Instance 1 (port 9091)\n');

  const alice = new GameClient('ws://localhost:9090', 'Alice');
  const bob = new GameClient('ws://localhost:9091', 'Bob');

  await delay(300);

  // Both join — triggers cross-instance matchmaking and wait for game start
  const [aMatch, bMatch] = await Promise.all([alice.join(), bob.join()]);

  console.log('\n--- Playing 5 rounds ---\n');

  for (let i = 0; i < 5; i++) {
    const aliceChoice = randomChoice();
    const bobChoice = randomChoice();

    await Promise.all([alice.makeMove(aliceChoice), bob.makeMove(bobChoice)]);
    await Promise.all([alice.waitForRoundResult(), bob.waitForRoundResult()]);

    if (i < 4) {
      await delay(300);
      await Promise.all([alice.requestNext(), bob.requestNext()]);
    }

    await delay(500);
  }

  console.log('\n--- Final results ---\n');
  await Promise.all([alice.waitForGameOver(), bob.waitForGameOver()]);

  alice.quit();
  bob.quit();

  await Promise.all([alice.waitForClose(), bob.waitForClose()]);
  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
