import { loadPlayerGameCounts, loadPairRecords, findExactCasing } from './common.js';

export async function runFriendzoneShow(
  playerArg: string,
  otherArg: string
): Promise<void> {
  const playerGameCounts = loadPlayerGameCounts();
  const pairs = loadPairRecords();

  const filterName1 = playerArg.trim().toLowerCase();
  const filterName2 = otherArg.trim().toLowerCase();

  const exactPlayer1 = findExactCasing(filterName1, playerGameCounts);
  const exactPlayer2 = findExactCasing(filterName2, playerGameCounts);

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
}
