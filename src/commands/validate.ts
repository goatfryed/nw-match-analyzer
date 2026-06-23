import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';

export async function validateSourceData(): Promise<void> {
  const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  if (!fs.existsSync(sourceCsvPath)) {
    throw new Error(`Source CSV not found at ${sourceCsvPath}. Please run download command first.`);
  }

  console.log(`Reading and parsing source CSV from ${sourceCsvPath}...`);
  const fileContent = fs.readFileSync(sourceCsvPath, 'utf8');
  const records: any[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    console.log('Source CSV is empty.');
    return;
  }

  const gameRowCounts = new Map<string, number>();
  for (const r of records) {
    if (!r.game) continue;
    gameRowCounts.set(r.game, (gameRowCounts.get(r.game) || 0) + 1);
  }

  const totalRows = records.length;
  const uniqueGameIds = gameRowCounts.size;
  const avgRowsPerGame = uniqueGameIds > 0 ? totalRows / uniqueGameIds : 0;
  const maxRowsPerGame = config.validation?.maxRowsPerGame ?? 45;

  console.log('\n=== CSV Validation Summary ===');
  console.log(`Total Rows:             ${totalRows}`);
  console.log(`Unique Game IDs:        ${uniqueGameIds}`);
  console.log(`Avg Rows per Game ID:   ${avgRowsPerGame.toFixed(2)}`);

  console.log(`\nChecking for game IDs exceeding ${maxRowsPerGame} rows...`);
  let warningCount = 0;
  for (const [gameId, count] of gameRowCounts.entries()) {
    if (count >= maxRowsPerGame) {
      console.warn(`⚠️ Warning: Game ID "${gameId}" has ${count} rows (exceeds limit of ${maxRowsPerGame})`);
      warningCount++;
    }
  }

  if (warningCount === 0) {
    console.log('✅ No game IDs exceed the limit.');
  } else {
    console.log(`\n⚠️ Total of ${warningCount} game ID(s) exceed the limit.`);
  }
}
