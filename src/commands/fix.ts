import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

interface CsvRecord {
  game: string;
  date: string;
  side: string;
  win: string;
  player: string;
  [key: string]: string;
}

function getLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
  }
  return matrix[a.length][b.length];
}

export async function runFixCommand(): Promise<void> {
  const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  if (!fs.existsSync(sourceCsvPath)) {
    throw new Error(`Source CSV not found at ${sourceCsvPath}. Please run download command first.`);
  }

  const fileContent = fs.readFileSync(sourceCsvPath, 'utf8');
  const records: CsvRecord[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // Count games per player
  const playerGames = new Map<string, number>();
  for (const r of records) {
    if (r.player) {
      playerGames.set(r.player, (playerGames.get(r.player) || 0) + 1);
    }
  }

  const uniquePlayers = Array.from(playerGames.keys());

  interface UnknownFinding {
    row: number;
    gameId: string;
    player: string;
  }

  interface TypoFinding {
    rowStr: string;
    firstRow: number;
    player: string;
    suggestions: string[];
  }

  const unknowns: UnknownFinding[] = [];
  const typos: TypoFinding[] = [];

  const playerOccurrences = new Map<string, number[]>();

  records.forEach((r, idx) => {
    const rowNum = idx + 2; // 1-based CSV line number (row 1 is header)
    const player = r.player || '';
    const gameId = r.game || '';

    if (!player) return;

    if (player.toLowerCase() === 'unknown') {
      unknowns.push({ row: rowNum, gameId, player });
      return;
    }

    if (!playerOccurrences.has(player)) {
      playerOccurrences.set(player, []);
    }
    playerOccurrences.get(player)!.push(rowNum);
  });

  // Check potential typos for each unique player
  for (const [player, rows] of playerOccurrences.entries()) {
    const currentGames = playerGames.get(player) || 0;
    const suggestions: string[] = [];

    for (const other of uniquePlayers) {
      if (other === player) continue;

      const otherGames = playerGames.get(other) || 0;
      if (otherGames >= currentGames) {
        const distance = getLevenshteinDistance(player.toLowerCase(), other.toLowerCase());
        const maxDistance = Math.ceil(player.length / 5);

        if (distance <= maxDistance) {
          suggestions.push(other);
        }
      }
    }

    if (suggestions.length > 0) {
      // Sort suggestions descending by games count, then alphabetically
      suggestions.sort((a, b) => {
        const gamesA = playerGames.get(a) || 0;
        const gamesB = playerGames.get(b) || 0;
        if (gamesB !== gamesA) {
          return gamesB - gamesA;
        }
        return a.localeCompare(b, undefined, { sensitivity: 'base' });
      });

      const firstRow = rows[0];
      let rowStr = String(firstRow);
      if (rows.length > 1) {
        rowStr += ` +${rows.length - 1}`;
      }
      typos.push({
        rowStr,
        firstRow,
        player,
        suggestions,
      });
    }
  }

  // Sort typos chronologically by their first occurrence
  typos.sort((a, b) => a.firstRow - b.firstRow);

  // Table 1: Unknown Players
  console.log('\n=== Unknown Players ===');
  console.log('Lists players recorded as "unknown" in the source data.\n');
  if (unknowns.length === 0) {
    console.log('  No unknown players found.');
  } else {
    console.log(
      '  ' +
      'Row'.padEnd(8) +
      'Game ID'.padEnd(20) +
      'Player'
    );
    console.log('  ' + '-'.repeat(45));
    unknowns.forEach((u) => {
      console.log(
        '  ' +
        String(u.row).padEnd(8) +
        u.gameId.padEnd(20) +
        u.player
      );
    });
  }

  // Table 2: Potential Typos
  console.log('\n=== Potential Typos ===');
  console.log('Lists players who have similar names to players with >= games (distance threshold: 1 per 5 characters, rounded up).\n');
  if (typos.length === 0) {
    console.log('  No potential typos found.');
  } else {
    console.log(
      '  ' +
      'Row'.padEnd(12) +
      'Player'.padEnd(25) +
      'Suggested Players'
    );
    console.log('  ' + '-'.repeat(65));
    typos.forEach((t) => {
      console.log(
        '  ' +
        t.rowStr.padEnd(12) +
        t.player.padEnd(25) +
        t.suggestions.join(', ')
      );
    });
  }
  console.log();
}
