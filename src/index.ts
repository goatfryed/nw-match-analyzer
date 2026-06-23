import dotenv from 'dotenv';
import path from 'path';
import { Command } from 'commander';
import { downloadSourceSheet } from './commands/download.js';
import { runFriendzoneList } from './commands/friendzone/list.js';
import { runFriendzoneShow } from './commands/friendzone/show.js';
import { runFriendzoneCliques } from './commands/friendzone/cliques.js';
import { runFriendzoneStacks } from './commands/friendzone/stacks.js';
import { validateSourceData } from './commands/validate.js';
import { calculateSourceMmr, runMmrList, runMmrShow } from './commands/mmr.js';
import { runMatchList, runMatchShow } from './commands/match.js';

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
  .command('validate')
  .description('Validate the downloaded source match data')
  .action(async () => {
    try {
      await validateSourceData();
    } catch (error) {
      console.error('Error running validation:', error);
      process.exit(1);
    }
  });
const friendzone = program
  .command('friendzone')
  .description('Friendzone analysis commands');

friendzone
  .command('list [player]')
  .description('Print sorted summary of top friends, enemies, and neutrals')
  .option('-t, --threshold <number>', 'minimum games played together', (val) => parseInt(val, 10))
  .option('-n, --lines <number>', 'number of pairs to print', (val) => parseInt(val, 10))
  .option('-s, --skip <number>', 'number of pairs to skip', (val) => parseInt(val, 10))
  .action(async (player, options) => {
    try {
      await runFriendzoneList(player, options);
    } catch (error) {
      console.error('Error running friendzone list:', error);
      process.exit(1);
    }
  });

friendzone
  .command('show <player> <other>')
  .description('Show details of a specific relationship')
  .action(async (player, other) => {
    try {
      await runFriendzoneShow(player, other);
    } catch (error) {
      console.error('Error running friendzone show:', error);
      process.exit(1);
    }
  });

friendzone
  .command('cliques')
  .description('Print groups/cliques of players who play together frequently')
  .option('-t, --threshold <number>', 'minimum games played together', (val) => parseInt(val, 10))
  .option('-f, --threshold-friendship <number>', 'friendship index threshold', (val) => parseFloat(val))
  .option('-a, --amount <number>', 'number of cliques to print', (val) => parseInt(val, 10))
  .option('-s, --min-size <number>', 'minimum clique size', (val) => parseInt(val, 10))
  .option('-m, --max-size <number>', 'maximum clique size', (val) => parseInt(val, 10))
  .action(async (options) => {
    try {
      await runFriendzoneCliques(options);
    } catch (error) {
      console.error('Error running friendzone cliques:', error);
      process.exit(1);
    }
  });

friendzone
  .command('stacks')
  .description('Print groups/stacks of players who play on the same team together frequently')
  .option('-t, --threshold <number>', 'minimum games played together on the same team', (val) => parseInt(val, 10))
  .option('-f, --threshold-friendship <number>', 'friendship index threshold', (val) => parseFloat(val))
  .option('-a, --amount <number>', 'number of stacks to print', (val) => parseInt(val, 10))
  .option('-s, --min-size <number>', 'minimum stack size', (val) => parseInt(val, 10))
  .option('-m, --max-size <number>', 'maximum stack size', (val) => parseInt(val, 10))
  .option('--include-subsets', 'include stacks that are subsets of larger stacks')
  .action(async (options) => {
    try {
      await runFriendzoneStacks(options);
    } catch (error) {
      console.error('Error running friendzone stacks:', error);
      process.exit(1);
    }
  });

program
  .command('calculate')
  .description('Calculate both MMR ratings and friendship insights from source CSV')
  .option('-d, --default-rating <number>', 'default rating', (val) => parseFloat(val))
  .option('-k, --k-factor <number>', 'K-factor constant', (val) => parseFloat(val))
  .option('--generations <number>', 'number of generations', (val) => parseInt(val, 10))
  .option('--calibration <number>', 'number of games for full calibration', (val) => parseInt(val, 10))
  .option('--rebuild', 'rebuild ratings and friendships from scratch')
  .option('--from <string>', 'start game ID reference (e.g. start, head, gameId, gameId+N)')
  .option('--to <string>', 'end game ID reference (e.g. gameId-N)')
  .action(async (options) => {
    try {
      await calculateSourceMmr(options);
    } catch (error) {
      console.error('Error running calculation:', error);
      process.exit(1);
    }
  });

const mmr = program
  .command('mmr')
  .description('MMR analysis commands');

mmr
  .command('list')
  .description('Print sorted summary of players MMR')
  .option('-t, --threshold <number>', 'minimum games played', (val) => parseInt(val, 10))
  .option('-n, --lines <number>', 'number of players to print', (val) => parseInt(val, 10))
  .option('-s, --skip <number>', 'number of players to skip', (val) => parseInt(val, 10))
  .option('--sort <string>', 'sort order (ascending or descending)')
  .option('--tail', 'display from the tail (bottom) of the leaderboard list')
  .option('--delta', 'sort leaderboard by delta MMR')
  .action(async (options) => {
    try {
      await runMmrList(options);
    } catch (error) {
      console.error('Error running MMR list:', error);
      process.exit(1);
    }
  });

mmr
  .command('show <player>')
  .description('Show MMR profile of a specific player')
  .option('-t, --threshold <number>', 'minimum games played threshold', (val) => parseInt(val, 10))
  .action(async (player, options) => {
    try {
      await runMmrShow(player, options);
    } catch (error) {
      console.error('Error running MMR show:', error);
      process.exit(1);
    }
  });

const match = program
  .command('match')
  .description('Match logs and statistics');

match
  .command('list')
  .description('Print list of matches')
  .option('-n, --lines <number>', 'number of matches to print', (val) => parseInt(val, 10))
  .option('-s, --skip <number>', 'number of matches to skip', (val) => parseInt(val, 10))
  .option('--tail', 'display from the tail (bottom) of the match list')
  .action(async (options) => {
    try {
      await runMatchList(options);
    } catch (error) {
      console.error('Error running match list:', error);
      process.exit(1);
    }
  });

match
  .command('show <matchRef>')
  .description('Show details of a specific match')
  .action(async (matchRef) => {
    try {
      await runMatchShow(matchRef);
    } catch (error) {
      console.error('Error running match show:', error);
      process.exit(1);
    }
  });

program.parse();
