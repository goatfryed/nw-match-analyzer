import dotenv from 'dotenv';
import path from 'path';
import { Command } from 'commander';
import { downloadSourceSheet } from './commands/download.js';
import { runFriendzoneAnalysis } from './commands/friendzone.js';
import { runFriendzoneShow } from './commands/show.js';
import { runFriendzoneStacks } from './commands/stacks.js';

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
  .command('show [player] [other]')
  .description('Print sorted summary of top friends, enemies, and neutrals')
  .option('-t, --threshold <number>', 'minimum games played together', (val) => parseInt(val, 10))
  .option('-a, --amount <number>', 'number of pairs to print', (val) => parseInt(val, 10))
  .action(async (player, other, options) => {
    try {
      await runFriendzoneShow(player, other, options);
    } catch (error) {
      console.error('Error running friendzone show:', error);
      process.exit(1);
    }
  });

friendzone
  .command('stacks')
  .description('Print groups/stacks of players who play together frequently')
  .option('-t, --threshold <number>', 'minimum games played together', (val) => parseInt(val, 10))
  .option('-f, --threshold-friendship <number>', 'friendship index threshold', (val) => parseFloat(val))
  .option('-a, --amount <number>', 'number of stacks to print', (val) => parseInt(val, 10))
  .option('-s, --min-size <number>', 'minimum stack size', (val) => parseInt(val, 10))
  .option('-m, --max-size <number>', 'maximum stack size', (val) => parseInt(val, 10))
  .action(async (options) => {
    try {
      await runFriendzoneStacks(options);
    } catch (error) {
      console.error('Error running friendzone stacks:', error);
      process.exit(1);
    }
  });

program.parse();
