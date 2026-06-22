import dotenv from 'dotenv';
import path from 'path';
import { Command } from 'commander';
import { downloadSourceSheet } from './commands/download.js';
import { runFriendzoneAnalysis } from './commands/friendzone.js';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const program = new Command();

program
  .name('nw-match-analyzer')
  .description('CLI tool to analyze scoreboard data of New World PvP matches')
  .version('1.0.0');

program
  .command('download')
  .description('Download the source match data from Google Sheets to CSV')
  .action(async () => {
    try {
      await downloadSourceSheet();
    } catch (error) {
      console.error('Error downloading source sheet:', error);
      process.exit(1);
    }
  });

program
  .command('friendzone')
  .description('Build upper triangular player same-team matrix')
  .action(async () => {
    try {
      await runFriendzoneAnalysis();
    } catch (error) {
      console.error('Error running friendzone analysis:', error);
      process.exit(1);
    }
  });

program.parse();
