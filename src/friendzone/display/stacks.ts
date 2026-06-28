import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { loadPairRecords } from '../index.js';
import { findStacks, SourceRecord } from '../cliques/stacks.js';
import config from '../../../config.js';

interface StacksOptions {
  threshold?: number;
  thresholdFriendship?: number;
  amount?: number;
  minSize?: number;
  maxSize?: number;
  includeSubsets?: boolean;
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
    player: r.player,
  }));
}

export async function runFriendzoneStacks(options: StacksOptions): Promise<void> {
  const threshold = options.threshold ?? config.friendzone?.matchThreshold ?? 5;
  const friendshipThreshold = options.thresholdFriendship ?? config.friendzone?.cliqueThreshold ?? 0.75;
  const amount = options.amount ?? config.friendzone?.amount ?? 10;
  const minSize = options.minSize ?? 3;
  const maxSize = options.maxSize ?? 5;
  const includeSubsets = options.includeSubsets ?? false;

  console.log(`Loading pairwise relationships...`);
  const pairs = loadPairRecords();

  console.log(`Loading matches and grouping teams...`);
  const sourceRecords = loadSourceRecords();

  console.log(`Analyzing stacks of sizes ${minSize} to ${maxSize} with mutual friendship >= ${friendshipThreshold.toFixed(4)}...`);

  const stacksBySize = findStacks(pairs, sourceRecords, {
    threshold,
    friendshipThreshold,
    minSize,
    maxSize,
    includeSubsets
  });

  for (let s = minSize; s <= maxSize; s++) {
    const list = stacksBySize.get(s) || [];
    list.sort((a, b) => b.score - a.score || a.players.localeCompare(b.players, undefined, { sensitivity: 'base' }));

    const titleSuffix = s === maxSize ? ' (or larger)' : '';
    console.log(`\n=== Stacks of ${s}${titleSuffix} (Top ${amount}) ===`);

    if (list.length === 0) {
      console.log('  No stacks found.');
      continue;
    }

    const displayList = list.slice(0, amount);
    const maxPlayersLen = Math.max(30, ...displayList.map((item) => item.players.length));

    const playersHeader = 'Players'.padEnd(maxPlayersLen);
    const scoreHeader = 'Stack Score'.padStart(12);
    const avgFriendshipHeader = 'Avg Friend'.padStart(12);
    const gamesHeader = 'Games (Team/Total)'.padStart(22);

    console.log(`  ${playersHeader}${scoreHeader}${avgFriendshipHeader}${gamesHeader}`);
    console.log(`  ${'-'.repeat(maxPlayersLen + 12 + 12 + 22)}`);

    displayList.forEach((stack) => {
      const playersCol = stack.players.padEnd(maxPlayersLen);
      const scoreCol = stack.score.toFixed(4).padStart(12);
      const avgFriendshipCol = stack.avgFriendship.toFixed(4).padStart(12);
      const gamesCol = `${stack.sameTeamCount}/${stack.sameGameCount}`.padStart(22);
      console.log(`  ${playersCol}${scoreCol}${avgFriendshipCol}${gamesCol}`);
    });
  }
}
