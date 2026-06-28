export interface PairRecord {
  player: string;
  other: string;
  sameGame: number;
  sameSide: number;
  friendshipIndex: number;
}

export interface CliqueResult {
  players: string[];
  avgFriendship: number;
}

function bronKerbosch(
  R: Set<string>,
  P: Set<string>,
  X: Set<string>,
  adj: Map<string, Set<string>>,
  cliques: string[][]
) {
  if (P.size === 0 && X.size === 0) {
    cliques.push(Array.from(R));
    return;
  }

  const P_union_X = new Set([...P, ...X]);
  let pivot = '';
  let maxDegree = -1;
  for (const u of P_union_X) {
    const neighbors = adj.get(u) || new Set<string>();
    const overlapSize = Array.from(neighbors).filter(v => P.has(v)).length;
    if (overlapSize > maxDegree) {
      maxDegree = overlapSize;
      pivot = u;
    }
  }

  const pivotNeighbors = adj.get(pivot) || new Set<string>();
  const P_without_neighbors = Array.from(P).filter(v => !pivotNeighbors.has(v));

  for (const v of P_without_neighbors) {
    const neighbors = adj.get(v) || new Set<string>();
    const nextR = new Set(R).add(v);
    const nextP = new Set(Array.from(P).filter(u => neighbors.has(u)));
    const nextX = new Set(Array.from(X).filter(u => neighbors.has(u)));

    bronKerbosch(nextR, nextP, nextX, adj, cliques);

    P.delete(v);
    X.add(v);
  }
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

export function findCliques(
  pairs: PairRecord[],
  options: {
    threshold: number;
    friendshipThreshold: number;
    minSize: number;
    maxSize: number;
  }
): {
  sizeBuckets: Map<number, CliqueResult[]>;
  activeVerticesCount: number;
} {
  const { threshold, friendshipThreshold, minSize, maxSize } = options;

  const adj = new Map<string, Set<string>>();
  const pairFriendshipIndex = new Map<string, number>();
  const allPlayers = new Set<string>();

  for (const r of pairs) {
    const player = r.player;
    const other = r.other;
    const sameGame = r.sameGame;
    const friendshipIndex = r.friendshipIndex;

    const key = `${player}:${other}`;
    pairFriendshipIndex.set(key, friendshipIndex);

    if (sameGame >= threshold && friendshipIndex >= friendshipThreshold) {
      allPlayers.add(player);
      allPlayers.add(other);

      if (!adj.has(player)) adj.set(player, new Set());
      if (!adj.has(other)) adj.set(other, new Set());

      adj.get(player)!.add(other);
      adj.get(other)!.add(player);
    }
  }

  const cliques: string[][] = [];
  bronKerbosch(new Set(), new Set(allPlayers), new Set(), adj, cliques);

  const sizeBuckets = new Map<number, CliqueResult[]>();

  for (const clique of cliques) {
    if (clique.length < minSize) continue;

    const sortedClique = clique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const avgFriendship = getAverageFriendship(sortedClique, pairFriendshipIndex);

    const bucketSize = clique.length >= maxSize ? maxSize : clique.length;

    if (!sizeBuckets.has(bucketSize)) {
      sizeBuckets.set(bucketSize, []);
    }
    sizeBuckets.get(bucketSize)!.push({ players: sortedClique, avgFriendship });
  }

  return { sizeBuckets, activeVerticesCount: allPlayers.size };
}
