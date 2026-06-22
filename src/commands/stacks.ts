import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';

interface PairRecord {
  player: string;
  other: string;
  sameGame: number;
  sameSide: number;
  friendshipIndex: number;
}

interface StacksOptions {
  threshold?: number;
  thresholdFriendship?: number;
  amount?: number;
  minSize?: number;
  maxSize?: number;
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

  // Pivot selection for optimization
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

export async function runFriendzoneStacks(options: StacksOptions): Promise<void> {
  const csvPath = path.resolve(process.cwd(), '.tmp/friendzone.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Friendzone CSV not found at ${csvPath}. Please run 'friendzone' generate command first.`);
  }

  const fileContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const threshold = options.threshold ?? config.friendzone?.matchThreshold ?? 5;
  const friendshipThreshold = options.thresholdFriendship ?? config.friendzone?.cliqueThreshold ?? 0.75;
  const amount = options.amount ?? config.friendzone?.amount ?? 10;
  const minSize = options.minSize ?? 3;
  const maxSize = options.maxSize ?? 5;

  console.log(`Building graph using relationships with >= ${threshold} games and friendship index >= ${friendshipThreshold.toFixed(4)}...`);

  const adj = new Map<string, Set<string>>();
  const pairFriendshipIndex = new Map<string, number>();
  const allPlayers = new Set<string>();

  for (const r of records) {
    const player = r.player;
    const other = r.other;
    const sameGame = parseInt(r['same game'], 10);
    const friendshipIndex = parseFloat(r['friendship index']);

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

  console.log(`Graph has ${allPlayers.size} active vertices (players with close relationships).`);

  const cliques: string[][] = [];
  bronKerbosch(new Set(), new Set(allPlayers), new Set(), adj, cliques);

  // Group cliques by size
  // We will bucket them into size 3, size 4, and size 5 (or larger)
  const sizeBuckets = new Map<number, Array<{ players: string[]; avgFriendship: number }>>();

  for (const clique of cliques) {
    if (clique.length < minSize) continue;

    const sortedClique = clique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const avgFriendship = getAverageFriendship(sortedClique, pairFriendshipIndex);

    // If clique size is larger than maxSize, we group it in the maxSize bucket (representing maxSize or larger)
    const bucketSize = clique.length >= maxSize ? maxSize : clique.length;

    if (!sizeBuckets.has(bucketSize)) {
      sizeBuckets.set(bucketSize, []);
    }
    sizeBuckets.get(bucketSize)!.push({ players: sortedClique, avgFriendship });
  }

  // Print buckets
  for (let s = minSize; s <= maxSize; s++) {
    const bucket = sizeBuckets.get(s) || [];
    // Sort by average friendship descending
    bucket.sort((a, b) => b.avgFriendship - a.avgFriendship);

    const titleSuffix = s === maxSize ? ' (or larger)' : '';
    console.log(`\n=== Stacks of ${s}${titleSuffix} (Top ${amount}) ===`);
    
    if (bucket.length === 0) {
      console.log('  No stacks found.');
      continue;
    }

    const displayList = bucket.slice(0, amount);
    displayList.forEach((stack, index) => {
      console.log(`  ${index + 1}. ${stack.players.join(', ')} (Friendship: ${stack.avgFriendship.toFixed(4)})`);
    });
  }
}
