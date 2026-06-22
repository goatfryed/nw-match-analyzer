import dotenv from 'dotenv';
import path from 'path';
import { Command } from 'commander';
import { downloadSourceSheet } from './commands/download.js';
import { runFriendzoneAnalysis } from './commands/friendzone.js';
import { runFriendzonePrint } from './commands/print.js';

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

const friendzone = program
  .command('friendzone')
  .description('Friendzone analysis commands');

friendzone
  .command('generate', { isDefault: true })
  .description('Generate friendzone CSV matrix')
  .action(async () => {
    try {
      await runFriendzoneAnalysis();
    } catch (error) {
      console.error('Error running friendzone analysis:', error);
      process.exit(1);
    }
  });

friendzone
  .command('print [player]')
  .description('Print sorted summary of top friends, enemies, and neutrals')
  .option('-t, --threshold <number>', 'minimum games played together', (val) => parseInt(val, 10))
  .option('-a, --amount <number>', 'number of pairs to print', (val) => parseInt(val, 10))
  .action(async (player, options) => {
    try {
      await runFriendzonePrint({ ...options, player });
    } catch (error) {
      console.error('Error running friendzone print:', error);
      process.exit(1);
    }
  });

program.parse();
