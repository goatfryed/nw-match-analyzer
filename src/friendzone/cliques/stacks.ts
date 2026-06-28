export interface PairRecord {
  player: string;
  other: string;
  sameGame: number;
  sameSide: number;
  friendshipIndex: number;
}

export interface SourceRecord {
  game: string;
  date: string;
  side: string;
  player: string;
}

export interface StackItem {
  players: string;
  sameTeamCount: number;
  sameGameCount: number;
  avgFriendship: number;
  score: number;
}

function getValidSubsets(
  players: string[],
  size: number,
  validPairs: Set<string>
): string[][] {
  const results: string[][] = [];
  const sorted = [...players].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  function backtrack(start: number, current: string[]) {
    if (current.length === size) {
      results.push([...current]);
      return;
    }

    for (let i = start; i < sorted.length; i++) {
      const nextPlayer = sorted[i];
      let isMutuallyFriend = true;
      for (const p of current) {
        const [a, b] = p < nextPlayer ? [p, nextPlayer] : [nextPlayer, p];
        if (!validPairs.has(`${a}:${b}`)) {
          isMutuallyFriend = false;
          break;
        }
      }

      if (isMutuallyFriend) {
        current.push(nextPlayer);
        backtrack(i + 1, current);
        current.pop();
      }
    }
  }

  backtrack(0, []);
  return results;
}

function getAverageFriendship(clique: string[], pairFriendshipIndex: Map<string, number>): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < clique.length; i++) {
    for (let j = i + 1; j < clique.length; j++) {
      const [a, b] = clique[i] < clique[j] ? [clique[i], clique[j]] : [clique[j], clique[i]];
      const key = `${a}:${b}`;
      sum += pairFriendshipIndex.get(key) || 0;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function findStacks(
  pairs: PairRecord[],
  sourceRecords: SourceRecord[],
  options: {
    threshold: number;
    friendshipThreshold: number;
    minSize: number;
    maxSize: number;
    includeSubsets: boolean;
  }
): Map<number, StackItem[]> {
  const { threshold, friendshipThreshold, minSize, maxSize, includeSubsets } = options;

  const validPairs = new Set<string>();
  const pairFriendshipIndex = new Map<string, number>();

  for (const r of pairs) {
    const [a, b] = r.player < r.other ? [r.player, r.other] : [r.other, r.player];
    pairFriendshipIndex.set(`${a}:${b}`, r.friendshipIndex);
    if (r.sameGame >= threshold && r.friendshipIndex >= friendshipThreshold) {
      validPairs.add(`${a}:${b}`);
    }
  }

  const teamsMap = new Map<string, string[]>();
  const playerGames = new Map<string, Set<string>>();

  for (const r of sourceRecords) {
    if (!r.game || !r.side || !r.player) continue;
    const matchKey = r.date ? `${r.game}_${r.date}` : r.game;
    const key = `${matchKey}:${r.side}`;

    if (!teamsMap.has(key)) {
      teamsMap.set(key, []);
    }
    const teamList = teamsMap.get(key)!;
    if (!teamList.includes(r.player)) {
      teamList.push(r.player);
    }

    if (!playerGames.has(r.player)) {
      playerGames.set(r.player, new Set());
    }
    playerGames.get(r.player)!.add(matchKey);
  }

  const stacksBySize = new Map<number, StackItem[]>();

  for (let s = minSize; s <= maxSize; s++) {
    const stackCounts = new Map<string, number>();

    for (const [_, players] of teamsMap) {
      const subsets = getValidSubsets(players, s, validPairs);
      for (const subset of subsets) {
        const key = subset.join(', ');
        stackCounts.set(key, (stackCounts.get(key) || 0) + 1);
      }
    }

    const list = Array.from(stackCounts.entries())
      .map(([playersStr, count]) => {
        const players = playersStr.split(', ');
        let sameGameCount = 0;
        if (players.length > 0) {
          let intersection = new Set(playerGames.get(players[0]) || []);
          for (let i = 1; i < players.length; i++) {
            const nextSet = playerGames.get(players[i]) || new Set();
            const nextIntersection = new Set<string>();
            for (const gId of intersection) {
              if (nextSet.has(gId)) {
                nextIntersection.add(gId);
              }
            }
            intersection = nextIntersection;
          }
          sameGameCount = intersection.size;
        }

        const avgFriendship = getAverageFriendship(players, pairFriendshipIndex);
        const score = sameGameCount > 0 ? avgFriendship * (count * count) / sameGameCount : 0;

        return {
          players: playersStr,
          sameTeamCount: count,
          sameGameCount,
          avgFriendship,
          score,
        };
      })
      .filter((item) => item.sameTeamCount >= threshold);

    stacksBySize.set(s, list);
  }

  if (!includeSubsets) {
    for (let s = minSize; s < maxSize; s++) {
      const currentList = stacksBySize.get(s) || [];
      const parents: Set<string>[] = [];
      for (let ps = s + 1; ps <= maxSize; ps++) {
        const parentList = stacksBySize.get(ps) || [];
        for (const parentStack of parentList) {
          parents.push(new Set(parentStack.players.split(', ')));
        }
      }

      const filtered = currentList.filter((stack) => {
        const currentPlayers = stack.players.split(', ');
        const isSub = parents.some((parentSet) =>
          currentPlayers.every((p) => parentSet.has(p))
        );
        return !isSub;
      });

      stacksBySize.set(s, filtered);
    }
  }

  return stacksBySize;
}
