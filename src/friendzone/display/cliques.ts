import { loadPairRecords } from '../index.js';
import { findCliques } from '../cliques/cliques.js';
import config from '../../../config.js';

interface CliquesOptions {
  threshold?: number;
  thresholdFriendship?: number;
  amount?: number;
  minSize?: number;
  maxSize?: number;
}

export async function runFriendzoneCliques(options: CliquesOptions): Promise<void> {
  const pairs = loadPairRecords();

  const threshold = options.threshold ?? config.friendzone?.matchThreshold ?? 5;
  const friendshipThreshold = options.thresholdFriendship ?? config.friendzone?.cliqueThreshold ?? 0.75;
  const amount = options.amount ?? config.friendzone?.amount ?? 10;
  const minSize = options.minSize ?? 3;
  const maxSize = options.maxSize ?? 5;

  console.log(`Building graph using relationships with >= ${threshold} games and friendship index >= ${friendshipThreshold.toFixed(4)}...`);

  const { sizeBuckets, activeVerticesCount } = findCliques(pairs, {
    threshold,
    friendshipThreshold,
    minSize,
    maxSize
  });

  console.log(`Graph has ${activeVerticesCount} active vertices (players with close relationships).`);

  for (let s = minSize; s <= maxSize; s++) {
    const bucket = sizeBuckets.get(s) || [];
    bucket.sort((a, b) => b.avgFriendship - a.avgFriendship);

    const titleSuffix = s === maxSize ? ' (or larger)' : '';
    console.log(`\n=== Cliques of ${s}${titleSuffix} (Top ${amount}) ===`);
    
    if (bucket.length === 0) {
      console.log('  No cliques found.');
      continue;
    }

    const displayList = bucket.slice(0, amount);
    displayList.forEach((clique, index) => {
      console.log(`  ${index + 1}. ${clique.players.join(', ')} (Friendship: ${clique.avgFriendship.toFixed(4)})`);
    });
  }
}
