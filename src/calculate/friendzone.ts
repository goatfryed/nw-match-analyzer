import { CohesionTracker } from './cohesion.js';

export interface PairRecord {
  player: string;
  other: string;
  sameGame: number;
  sameSide: number;
  friendshipIndex: number;
}

export function generateFriendzoneRecords(tracker: CohesionTracker): PairRecord[] {
  const pairList: PairRecord[] = [];

  // Extract pair records where games played together > 0
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

  // Sort by player name ascending, then by other name ascending
  pairList.sort((a, b) => {
    const compPlayer = a.player.localeCompare(b.player, undefined, { sensitivity: 'base' });
    if (compPlayer !== 0) return compPlayer;
    return a.other.localeCompare(b.other, undefined, { sensitivity: 'base' });
  });

  return pairList;
}
