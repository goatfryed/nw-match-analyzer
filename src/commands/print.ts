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

interface PrintOptions {
  threshold?: number;
  amount?: number;
  player?: string;
}

function printTable(
  list: PairRecord[],
  friendshipPad: number,
  queriedPlayer?: { name: string; gamesCount: number }
) {
  if (list.length === 0) {
    console.log('  No pairs found matching criteria.');
    return;
  }

  const padNum = (num: number, length: number) => String(num).padStart(length, '0');

  if (queriedPlayer && queriedPlayer.gamesCount > 0) {
    const filterNameLower = queriedPlayer.name.toLowerCase();
    const percentGamesPad = String(queriedPlayer.gamesCount).length;
    // Headers: Player, Friendship, %games
    console.log(
      '  ' +
      'Player'.padEnd(20) +
      'Friendship'.padEnd(25) +
      '%games'
    );
    console.log('  ' + '-'.repeat(65));
    for (const item of list) {
      // Print the name of the person that was not queried
      const nonQueriedPlayer = item.player.toLowerCase() === filterNameLower ? item.other : item.player;
      
      const friendshipStr = `${item.friendshipIndex.toFixed(4)} (${padNum(item.sameSide, friendshipPad)}/${padNum(item.sameGame, friendshipPad)})`;
      const gamesRatio = item.sameGame / queriedPlayer.gamesCount;
      const gamesRatioStr = `${gamesRatio.toFixed(4)} (${padNum(item.sameGame, percentGamesPad)}/${padNum(queriedPlayer.gamesCount, percentGamesPad)})`;

      console.log(
        '  ' +
        nonQueriedPlayer.padEnd(20) +
        friendshipStr.padEnd(25) +
        gamesRatioStr
      );
    }
  } else {
    // Headers: Player, Other, Friendship
    console.log(
      '  ' +
      'Player'.padEnd(20) +
      'Other'.padEnd(20) +
      'Friendship'
    );
    console.log('  ' + '-'.repeat(60));
    for (const item of list) {
      const friendshipStr = `${item.friendshipIndex.toFixed(4)} (${padNum(item.sameSide, friendshipPad)}/${padNum(item.sameGame, friendshipPad)})`;
      console.log(
        '  ' +
        item.player.padEnd(20) +
        item.other.padEnd(20) +
        friendshipStr
      );
    }
  }
}

export async function runFriendzonePrint(options: PrintOptions): Promise<void> {
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

  let pairs: PairRecord[] = records.map((r: any) => ({
    player: r.player,
    other: r.other,
    sameGame: parseInt(r['same game'], 10),
    sameSide: parseInt(r['same side'], 10),
    friendshipIndex: parseFloat(r['friendship index']),
  }));

  const threshold = options.threshold ?? config.friendzone?.matchThreshold ?? 5;
  const amount = options.amount ?? config.friendzone?.amount ?? 10;

  console.log(`Filtering relationships with >= ${threshold} games played together...`);
  pairs = pairs.filter(p => p.sameGame >= threshold);

  let queriedPlayer: { name: string; gamesCount: number } | undefined;

  if (options.player) {
    const filterName = options.player.trim().toLowerCase();
    console.log(`Filtering relationships including player: "${options.player}"...`);
    pairs = pairs.filter(p =>
      p.player.toLowerCase() === filterName ||
      p.other.toLowerCase() === filterName
    );

    // Compute total games played by the queried player from source.csv
    const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
    if (fs.existsSync(sourceCsvPath)) {
      const sourceContent = fs.readFileSync(sourceCsvPath, 'utf8');
      const sourceRecords = parse(sourceContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const playerGameCounts = new Map<string, number>();
      for (const r of sourceRecords) {
        if (r.name) {
          playerGameCounts.set(r.name, (playerGameCounts.get(r.name) || 0) + 1);
        }
      }

      // Find the exact casing of the player name from the counts map keys
      let exactQueriedPlayerName = options.player;
      for (const key of playerGameCounts.keys()) {
        if (key.toLowerCase() === filterName) {
          exactQueriedPlayerName = key;
          break;
        }
      }

      const gamesCount = playerGameCounts.get(exactQueriedPlayerName) || 0;
      queriedPlayer = { name: exactQueriedPlayerName, gamesCount };
    }
  }

  console.log(`Total relationships found: ${pairs.length}`);

  // Bounded insertion helper for O(N * K) selection (extremely efficient for small K)
  function getTopK<T>(items: T[], k: number, compareFn: (a: T, b: T) => number): T[] {
    const result: T[] = [];
    for (const item of items) {
      let insertIdx = result.length;
      for (let i = 0; i < result.length; i++) {
        if (compareFn(item, result[i]) < 0) {
          insertIdx = i;
          break;
        }
      }
      if (insertIdx < k) {
        result.splice(insertIdx, 0, item);
        if (result.length > k) {
          result.pop();
        }
      }
    }
    return result;
  }

  // Friends (highest friendshipIndex descending, then sameGame descending)
  const friends = getTopK(pairs, amount, (a, b) => {
    if (b.friendshipIndex !== a.friendshipIndex) {
      return b.friendshipIndex - a.friendshipIndex;
    }
    return b.sameGame - a.sameGame;
  });

  // Enemies (lowest friendshipIndex ascending, then sameGame descending)
  const enemies = getTopK(pairs, amount, (a, b) => {
    if (a.friendshipIndex !== b.friendshipIndex) {
      return a.friendshipIndex - b.friendshipIndex;
    }
    return b.sameGame - a.sameGame;
  });

  // Neutrals (closest to 0.5 absolute difference, then sameGame descending)
  const neutrals = getTopK(pairs, amount, (a, b) => {
    const distA = Math.abs(a.friendshipIndex - 0.5);
    const distB = Math.abs(b.friendshipIndex - 0.5);
    if (distA !== distB) {
      return distA - distB;
    }
    return b.sameGame - a.sameGame;
  });

  // Calculate max digits of sameGame across all displayed items
  const allPrintedItems = [...friends, ...enemies, ...neutrals];
  const maxFriendshipDigits = allPrintedItems.reduce(
    (max, item) => Math.max(max, String(item.sameGame).length),
    0
  );

  console.log(`\n=== Top ${friends.length} Friends ===`);
  printTable(friends, maxFriendshipDigits, queriedPlayer);

  console.log(`\n=== Top ${enemies.length} Enemies ===`);
  printTable(enemies, maxFriendshipDigits, queriedPlayer);

  console.log(`\n=== Top ${neutrals.length} Neutrals ===`);
  printTable(neutrals, maxFriendshipDigits, queriedPlayer);
}
