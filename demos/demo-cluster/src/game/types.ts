export type Choice = 'rock' | 'paper' | 'scissors';

export const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

export const MATCH_TOTAL_ROUNDS = 5;
export const MATCH_WIN_TARGET = 3;

export const BEATS: Record<Choice, Choice> = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

export type RoundOutcome = 'p1' | 'p2' | 'draw';

export function evaluateRound(a: Choice, b: Choice): RoundOutcome {
  if (a === b) return 'draw';
  if (BEATS[a] === b) return 'p1';
  return 'p2';
}

// ── Client → Server messages ──

export type ClientMessage =
  | { type: 'join'; playerName: string }
  | { type: 'quit' }
  | { type: 'move'; choice: Choice }
  | { type: 'next' };

// ── Server → Client messages ──

export type ServerMessage =
  | { type: 'queued' }
  | { type: 'matched'; gameId: string; opponentName: string }
  | { type: 'game_start'; gameId: string; opponentName: string; round: number; totalRounds: number; choices: Choice[] }
  | { type: 'move_ok'; gameId: string; round: number }
  | { type: 'round_result'; gameId: string; round: number; yourChoice: Choice; opponentChoice: Choice; outcome: RoundOutcome; scores: [number, number] }
  | { type: 'game_over'; gameId: string; result: 'win' | 'lose' | 'draw'; yourScore: number; opponentScore: number; rounds: number }
  | { type: 'opponent_quit'; gameId: string }
  | { type: 'error'; message: string };

// ── Internal types ──

export interface PlayerInfo {
  id: string;
  name: string;
}

export interface RoundState {
  p1Choice: Choice | null;
  p2Choice: Choice | null;
}

export interface GameState {
  id: string;
  p1: PlayerInfo;
  p2: PlayerInfo;
  rounds: RoundState[];
  scores: [number, number];
  totalRounds: number;
  winTarget: number;
}

// ── Redis keys ──

export const R = {
  queue: (instanceId: string) => `ionet:game:queue:${instanceId}`,
  playerGame: (playerId: string) => `ionet:game:player:${playerId}`,
  playerInstance: (playerId: string) => `ionet:game:pinstance:${playerId}`,
  game: (gameId: string) => `ionet:game:data:${gameId}`,
  matchCoord: (p1Id: string, p2Id: string) => {
    const sorted = [p1Id, p2Id].sort();
    return `ionet:game:match:${sorted[0]}:${sorted[1]}`;
  },
};

// ── Pub/Sub channels ──

export const CH = {
  match: 'ionet:game:match',
  notify: 'ionet:game:notify',
};
