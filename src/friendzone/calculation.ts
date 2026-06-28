import { CohesionTracker } from '../elo/cohesion.js';
import { CsvRecord, SortedMatch, parseDate, resolveIndex } from '../elo/calculation.js';

export interface PairRecord {
  player: string;
  other: string;
  sameGame: number;
  sameSide: number;
  friendshipIndex: number;
}

export function generateFriendzoneRecords(tracker: CohesionTracker): PairRecord[] {
  const pairList: PairRecord[] = [];

  for (const [key, sameGameCount] of tracker.sameGame.entries()) {
    if (sameGameCount > 0) {
      const [player, other] = key.split(':');
      const sameSideCount = tracker.sameSide.get(key) || 0;
      const friendshipIndex = sameSideCount / sameGameCount;

      pairList.push({
        player,
        other,
        sameGame: sameGameCount,
        sameSide: sameSideCount,
        friendshipIndex,
      });
    }
  }

  pairList.sort((a, b) => {
    const compPlayer = a.player.localeCompare(b.player, undefined, { sensitivity: 'base' });
    if (compPlayer !== 0) return compPlayer;
    return a.other.localeCompare(b.other, undefined, { sensitivity: 'base' });
  });

  return pairList;
}

export function calculateFriends(
  records: CsvRecord[],
  options: {
    rebuild?: boolean;
    fromMatchRef?: string;
    toMatchRef?: string;
    previousFriendshipsSameGame?: Map<string, number>;
    previousFriendshipsSameSide?: Map<string, number>;
    previousMatchHead?: string;
    maxRowsPerGame?: number;
  }
): {
  friendships: PairRecord[];
  matchHead: string;
  prefixGameIds: Set<string>;
} {
  const maxRowsPerGame = options.maxRowsPerGame ?? 45;
  const {
    rebuild = false,
    fromMatchRef,
    toMatchRef,
    previousFriendshipsSameGame = new Map(),
    previousFriendshipsSameSide = new Map(),
    previousMatchHead,
  } = options;

  const games = new Map<string, CsvRecord[]>();
  for (const record of records) {
    const game = record.game;
    const date = record.date;
    const player = record.player;
    const side = record.side;

    if (!game || !player || !side) continue;

    const matchKey = date ? `${game}_${date}` : game;
    if (!games.has(matchKey)) {
      games.set(matchKey, []);
    }
    games.get(matchKey)!.push(record);
  }

  const sortedMatches: SortedMatch[] = Array.from(games.entries())
    .map(([matchKey, participants]) => {
      const dateStr = participants[0]?.date || '';
      const dateObj = dateStr ? parseDate(dateStr) : new Date(0);
      const gameId = participants[0]?.game || '';
      return { matchKey, participants, date: dateObj, gameId };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const m of sortedMatches) {
    if (m.participants.length >= maxRowsPerGame) {
      console.warn(`⚠️ Warning: Match "${m.matchKey}" has ${m.participants.length} participants (exceeds limit of ${maxRowsPerGame})`);
    }
  }

  const matchHeadIndex = previousMatchHead
    ? sortedMatches.findIndex((m) => m.gameId === previousMatchHead)
    : -1;

  const defaultFromIndex = (rebuild || matchHeadIndex === -1) ? 0 : matchHeadIndex + 1;
  const defaultToIndex = sortedMatches.length - 1;

  const fromIndex = resolveIndex(fromMatchRef, sortedMatches, matchHeadIndex, defaultFromIndex);
  const toIndex = resolveIndex(toMatchRef, sortedMatches, matchHeadIndex, defaultToIndex);

  const matchesToProcess = sortedMatches.slice(fromIndex, toIndex + 1);

  if (matchesToProcess.length > 0) {
    console.log(`Processing matches starting from ${matchesToProcess[0].gameId}`);
  }

  const tracker = new CohesionTracker();

  if (!rebuild) {
    for (const [k, v] of previousFriendshipsSameGame.entries()) {
      tracker.sameGame.set(k, v);
    }
    for (const [k, v] of previousFriendshipsSameSide.entries()) {
      tracker.sameSide.set(k, v);
    }
  }

  for (const match of matchesToProcess) {
    const bluePlayers = match.participants
      .filter((p) => p.side === 'blue')
      .map((p) => p.player);
    const redPlayers = match.participants
      .filter((p) => p.side === 'red')
      .map((p) => p.player);

    if (bluePlayers.length === 0 || redPlayers.length === 0) {
      continue;
    }

    tracker.recordMatch(bluePlayers, redPlayers);
  }

  const friendships = generateFriendzoneRecords(tracker);

  const lastProcessed = matchesToProcess[matchesToProcess.length - 1];
  if (lastProcessed) {
    console.log(`Processed ${matchesToProcess.length} matches up to ${lastProcessed.gameId}`);
  }
  const matchHead = lastProcessed ? lastProcessed.gameId : (previousMatchHead || '');

  const prefixGameIds = new Set<string>();
  for (let i = 0; i < fromIndex; i++) {
    prefixGameIds.add(sortedMatches[i].gameId);
  }

  return { friendships, matchHead, prefixGameIds };
}
