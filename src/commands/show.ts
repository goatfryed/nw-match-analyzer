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

interface ShowOptions {
  threshold?: number;
  amount?: number;
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

export async function runFriendzoneShow(
  playerArg?: string,
  otherArg?: string,
  options: ShowOptions = {}
): Promise<void> {
  const csvPath = path.resolve(process.cwd(), '.tmp/friendzone.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Friendzone CSV not found at ${csvPath}. Please run 'friendzone' generate command first.`);
  }

  // Load total game counts for validation and single-player %games
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

  const playerGameCounts = new Map<string, number>();
  for (const r of sourceRecords) {
    if (r.name) {
      playerGameCounts.set(r.name, (playerGameCounts.get(r.name) || 0) + 1);
    }
  }

  const fileContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const pairs: PairRecord[] = records.map((r: any) => ({
    player: r.player,
    other: r.other,
    sameGame: parseInt(r['same game'], 10),
    sameSide: parseInt(r['same side'], 10),
    friendshipIndex: parseFloat(r['friendship index']),
  }));

  // Handle Case 1: Two Players Provided
  if (playerArg && otherArg) {
    const filterName1 = playerArg.trim().toLowerCase();
    const filterName2 = otherArg.trim().toLowerCase();

    // Find exact casing
    let exactPlayer1 = '';
    let exactPlayer2 = '';
    for (const key of playerGameCounts.keys()) {
      if (key.toLowerCase() === filterName1) exactPlayer1 = key;
      if (key.toLowerCase() === filterName2) exactPlayer2 = key;
    }

    if (!exactPlayer1 || !exactPlayer2) {
      if (!exactPlayer1) {
        console.log(`Player "${playerArg}" was not found in the dataset.`);
      }
      if (!exactPlayer2) {
        console.log(`Player "${otherArg}" was not found in the dataset.`);
      }
      return;
    }

    // Find relationship details order-independently
    const matchedPair = pairs.find(p =>
      (p.player.toLowerCase() === filterName1 && p.other.toLowerCase() === filterName2) ||
      (p.player.toLowerCase() === filterName2 && p.other.toLowerCase() === filterName1)
    );

    const sameGame = matchedPair ? matchedPair.sameGame : 0;
    const sameSide = matchedPair ? matchedPair.sameSide : 0;
    const friendshipIndex = matchedPair ? matchedPair.friendshipIndex : 0.0;

    console.log(`${exactPlayer1} games total: ${playerGameCounts.get(exactPlayer1)}`);
    console.log(`${exactPlayer2} games total: ${playerGameCounts.get(exactPlayer2)}`);
    console.log(`same game: ${sameGame}`);
    console.log(`same side: ${sameSide}`);
    console.log(`friendship index: ${friendshipIndex.toFixed(4)}`);
    return;
  }

  // Handle Case 2: One Player or No Players Provided
  let filteredPairs = pairs;
  const threshold = options.threshold ?? config.friendzone?.matchThreshold ?? 5;
  const amount = options.amount ?? config.friendzone?.amount ?? 10;

  console.log(`Filtering relationships with >= ${threshold} games played together...`);
  filteredPairs = filteredPairs.filter(p => p.sameGame >= threshold);

  let queriedPlayer: { name: string; gamesCount: number } | undefined;

  if (playerArg) {
    const filterName = playerArg.trim().toLowerCase();
    console.log(`Filtering relationships including player: "${playerArg}"...`);
    filteredPairs = filteredPairs.filter(p =>
      p.player.toLowerCase() === filterName ||
      p.other.toLowerCase() === filterName
    );

    let exactQueriedPlayerName = playerArg;
    for (const key of playerGameCounts.keys()) {
      if (key.toLowerCase() === filterName) {
        exactQueriedPlayerName = key;
        break;
      }
    }

    const gamesCount = playerGameCounts.get(exactQueriedPlayerName) || 0;
    if (gamesCount === 0) {
      console.log(`Player "${playerArg}" was not found in the dataset.`);
      return;
    }
    queriedPlayer = { name: exactQueriedPlayerName, gamesCount };
  }

  console.log(`Total relationships found: ${filteredPairs.length}`);

  // Bounded insertion helper for O(N * K) selection
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
  const friends = getTopK(filteredPairs, amount, (a, b) => {
    if (b.friendshipIndex !== a.friendshipIndex) {
      return b.friendshipIndex - a.friendshipIndex;
    }
    return b.sameGame - a.sameGame;
  });

  // Enemies (lowest friendshipIndex ascending, then sameGame descending)
  const enemies = getTopK(filteredPairs, amount, (a, b) => {
    if (a.friendshipIndex !== b.friendshipIndex) {
      return a.friendshipIndex - b.friendshipIndex;
    }
    return b.sameGame - a.sameGame;
  });

  // Neutrals (closest to 0.5 absolute difference, then sameGame descending)
  const neutrals = getTopK(filteredPairs, amount, (a, b) => {
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
