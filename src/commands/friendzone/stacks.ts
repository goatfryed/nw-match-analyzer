import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { loadPairRecords } from './common.js';
import config from '../../../config.js';

interface StacksOptions {
  threshold?: number;
  thresholdFriendship?: number;
  amount?: number;
  minSize?: number;
  maxSize?: number;
}

interface SourceRecord {
  game: string;
  date: string;
  side: string;
  name: string;
}

function loadSourceRecords(): SourceRecord[] {
  const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  if (!fs.existsSync(sourceCsvPath)) {
    throw new Error(`Source CSV not found at ${sourceCsvPath}. Please run download command first.`);
  }

  const sourceContent = fs.readFileSync(sourceCsvPath, 'utf8');
  const sourceRecords = parse(sourceContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return sourceRecords.map((r: any) => ({
    game: r.game,
    date: r.date,
    side: r.side,
    name: r.name,
  }));
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

export async function runFriendzoneStacks(options: StacksOptions): Promise<void> {
  const threshold = options.threshold ?? config.friendzone?.matchThreshold ?? 5;
  const friendshipThreshold = options.thresholdFriendship ?? config.friendzone?.cliqueThreshold ?? 0.75;
  const amount = options.amount ?? config.friendzone?.amount ?? 10;
  const minSize = options.minSize ?? 3;
  const maxSize = options.maxSize ?? 5;

  console.log(`Loading pairwise relationships...`);
  const pairs = loadPairRecords();
  const validPairs = new Set<string>();

  for (const r of pairs) {
    if (r.sameGame >= threshold && r.friendshipIndex >= friendshipThreshold) {
      const [a, b] = r.player < r.other ? [r.player, r.other] : [r.other, r.player];
      validPairs.add(`${a}:${b}`);
    }
  }

  console.log(`Loading matches and grouping teams...`);
  const sourceRecords = loadSourceRecords();
  const teamsMap = new Map<string, string[]>(); // key: "uniqueMatchKey:side" -> player names
  const playerGames = new Map<string, Set<string>>(); // player name -> set of uniqueMatchKeys

  for (const r of sourceRecords) {
    if (!r.game || !r.side || !r.name) continue;
    const matchKey = r.date ? `${r.game}_${r.date}` : r.game;
    const key = `${matchKey}:${r.side}`;

    if (!teamsMap.has(key)) {
      teamsMap.set(key, []);
    }
    const teamList = teamsMap.get(key)!;
    if (!teamList.includes(r.name)) {
      teamList.push(r.name);
    }

    if (!playerGames.has(r.name)) {
      playerGames.set(r.name, new Set());
    }
    playerGames.get(r.name)!.add(matchKey);
  }

  console.log(`Analyzing stacks of sizes ${minSize} to ${maxSize} with mutual friendship >= ${friendshipThreshold.toFixed(4)}...`);

  // Count co-occurrences of valid player subsets on the same team
  for (let s = minSize; s <= maxSize; s++) {
    const stackCounts = new Map<string, number>();

    for (const [_, players] of teamsMap) {
      // Find all valid subsets of size s within this team
      const subsets = getValidSubsets(players, s, validPairs);
      for (const subset of subsets) {
        const key = subset.join(', ');
        stackCounts.set(key, (stackCounts.get(key) || 0) + 1);
      }
    }

    const sortedStacks = Array.from(stackCounts.entries())
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

        return {
          players: playersStr,
          sameTeamCount: count,
          sameGameCount,
        };
      })
      .filter((item) => item.sameTeamCount >= threshold)
      .sort((a, b) => b.sameTeamCount - a.sameTeamCount || a.players.localeCompare(b.players, undefined, { sensitivity: 'base' }));

    const titleSuffix = s === maxSize ? ' (or larger)' : '';
    console.log(`\n=== Stacks of ${s}${titleSuffix} (Top ${amount}) ===`);

    if (sortedStacks.length === 0) {
      console.log('  No stacks found.');
      continue;
    }

    const displayList = sortedStacks.slice(0, amount);
    displayList.forEach((stack, index) => {
      console.log(`  ${index + 1}. ${stack.players} (${stack.sameTeamCount}/${stack.sameGameCount} games together)`);
    });
  }
}
