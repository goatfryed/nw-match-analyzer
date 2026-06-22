import { loadPlayerGameCounts, loadPairRecords, findExactCasing, PairRecord } from './common.js';
import config from '../../../config.js';

interface ListOptions {
  threshold?: number;
  lines?: number;
  skip?: number;
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

export async function runFriendzoneList(
  playerArg?: string,
  options: ListOptions = {}
): Promise<void> {
  const playerGameCounts = loadPlayerGameCounts();
  const pairs = loadPairRecords();

  let filteredPairs = pairs;
  const threshold = options.threshold ?? config.friendzone?.matchThreshold ?? 5;
  const lines = options.lines ?? config.friendzone?.amount ?? 10;
  const skip = options.skip ?? 0;

  console.log(`Filtering relationships with >= ${threshold} games played together...`);
  filteredPairs = filteredPairs.filter(p => p.sameGame >= threshold);

  let queriedPlayer: { name: string; gamesCount: number } | undefined;

  if (playerArg) {
    const filterName = playerArg.trim().toLowerCase();
    const exactQueriedPlayerName = findExactCasing(filterName, playerGameCounts);
    if (!exactQueriedPlayerName) {
      console.log(`Player "${playerArg}" was not found in the dataset.`);
      return;
    }
    console.log(`Filtering relationships including player: "${exactQueriedPlayerName}"...`);
    filteredPairs = filteredPairs.filter(p =>
      p.player.toLowerCase() === filterName ||
      p.other.toLowerCase() === filterName
    );

    const gamesCount = playerGameCounts.get(exactQueriedPlayerName) || 0;
    queriedPlayer = { name: exactQueriedPlayerName, gamesCount };
  }

  console.log(`Total relationships found: ${filteredPairs.length}`);
  console.log(`Printing top Friends, Enemies, and Neutrals (Skip: ${skip}, Lines: ${lines})...`);

  // Friends (highest friendshipIndex descending, then sameGame descending)
  const sortedFriends = [...filteredPairs].sort((a, b) => {
    if (b.friendshipIndex !== a.friendshipIndex) {
      return b.friendshipIndex - a.friendshipIndex;
    }
    return b.sameGame - a.sameGame;
  });
  // Enemies (lowest friendshipIndex ascending, then sameGame descending)
  const sortedEnemies = [...filteredPairs].sort((a, b) => {
    if (a.friendshipIndex !== b.friendshipIndex) {
      return a.friendshipIndex - b.friendshipIndex;
    }
    return b.sameGame - a.sameGame;
  });

  // Neutrals (closest to 0.5 absolute difference, then sameGame descending)
  const sortedNeutrals = [...filteredPairs].sort((a, b) => {
    const distA = Math.abs(a.friendshipIndex - 0.5);
    const distB = Math.abs(b.friendshipIndex - 0.5);
    if (distA !== distB) {
      return distA - distB;
    }
    return b.sameGame - a.sameGame;
  });

  const friends = sortedFriends.slice(skip, skip + lines);
  const enemies = sortedEnemies.slice(skip, skip + lines);
  const neutrals = sortedNeutrals.slice(skip, skip + lines);

  // Calculate max digits of sameGame across all displayed items
  const allPrintedItems = [...friends, ...enemies, ...neutrals];
  const maxFriendshipDigits = allPrintedItems.reduce(
    (max, item) => Math.max(max, String(item.sameGame).length),
    0
  );

  console.log(`\n=== Friends ===`);
  printTable(friends, maxFriendshipDigits, queriedPlayer);

  console.log(`\n=== Enemies ===`);
  printTable(enemies, maxFriendshipDigits, queriedPlayer);

  console.log(`\n=== Neutrals ===`);
  printTable(neutrals, maxFriendshipDigits, queriedPlayer);
}
