import dotenv from 'dotenv';
import path from 'path';
import { Command } from 'commander';
import { downloadSourceSheet } from './commands/download.js';
import { runFriendzoneList } from './friendzone/display/list.js';
import { runFriendzoneShow } from './friendzone/display/show.js';
import { runFriendzoneCliques } from './friendzone/display/cliques.js';
import { runFriendzoneStacks } from './friendzone/display/stacks.js';
import { validateSourceData } from './commands/validate.js';
import { runEloList } from './elo/display/list.js';
import { runEloShow } from './elo/display/show.js';
import { runListGrinders } from './commands/grinders.js';
import { runListPlayers } from './commands/players.js';
import { calculateSourceElo } from './elo/index.js';
import { calculateSourceFriends } from './friendzone/index.js';
import { runMatchList, runMatchShow } from './commands/match.js';
import { uploadCsvSheet } from './commands/upload.js';
import { runExplain } from './commands/explain.js';
import { runFixCommand } from './commands/fix.js';

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

program
  .command('upload [type]')
  .description('Upload local CSV data to Google Sheets (e.g. "matches", "mmr" or leave empty to upload both)')
  .action(async (type) => {
    try {
      await uploadCsvSheet(type);
    } catch (error) {
      console.error('Error running upload:', error);
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

const calculate = program
  .command('calculate')
  .description('Calculate both Elo ratings and friendship insights from source CSV')
  .option('--rebuild', 'rebuild ratings from scratch')
  .option('--from <string>', 'start game ID reference (e.g. start, head, gameId, gameId+N)')
  .option('--to <string>', 'end game ID reference (e.g. gameId-N)');

calculate.action(async (options) => {
  try {
    await calculateSourceFriends(options);
    await calculateSourceElo(options);
  } catch (error) {
    console.error('Error running calculation:', error);
    process.exit(1);
  }
});

const eloCmd = calculate
  .command('elo')
  .description('Calculate Elo ratings only from source CSV')
  .option('-d, --default-rating <number>', 'default rating', (val) => parseFloat(val))
  .option('-k, --k-factor <number>', 'K-factor constant', (val) => parseFloat(val))
  .option('--generations <number>', 'number of generations', (val) => parseInt(val, 10))
  .option('--calibration <number>', 'number of games for full calibration', (val) => parseInt(val, 10))
  .option('--calibration-factor <number>', 'calibration K-factor multiplier', (val) => parseFloat(val))
  .option('--score-factor <number>', 'multiplier for team scores relative to win bonus', (val) => parseFloat(val));

eloCmd.action(async (options) => {
  try {
    const mergedOptions = { ...calculate.opts(), ...options };
    await calculateSourceElo(mergedOptions);
  } catch (error) {
    console.error('Error running Elo calculation:', error);
    process.exit(1);
  }
});

const friendsCmd = calculate
  .command('friends')
  .description('Calculate friendship insights only from source CSV');

friendsCmd.action(async (options) => {
  try {
    const mergedOptions = { ...calculate.opts(), ...options };
    await calculateSourceFriends(mergedOptions);
  } catch (error) {
    console.error('Error running friendship calculation:', error);
    process.exit(1);
  }
});

const elo = program
  .command('elo')
  .description('Elo analysis commands');

elo
  .command('list')
  .description('Print sorted summary of players Elo')
  .option('-n, --lines <number>', 'number of players to print', (val) => parseInt(val, 10))
  .option('-s, --skip <number>', 'number of players to skip', (val) => parseInt(val, 10))
  .option('--sort <string>', 'sort order (ascending or descending)')
  .option('--tail', 'display from the tail (bottom) of the leaderboard list')
  .option('--delta', 'sort leaderboard by delta Elo')
  .option('--unredact', 'show unredacted Elo and rank for players below 50% of the ladder')
  .action(async (options) => {
    try {
      await runEloList(options);
    } catch (error) {
      console.error('Error running Elo list:', error);
      process.exit(1);
    }
  });

elo
  .command('show <player>')
  .description('Show Elo profile of a specific player')
  .option('--unredact', 'show unredacted Elo and rank for players below 50% of the ladder')
  .action(async (player, options) => {
    try {
      await runEloShow(player, options);
    } catch (error) {
      console.error('Error running Elo show:', error);
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

program
  .command('explain <gameId> [player]')
  .description('Simulate and explain the outcome of a game on Elo and friendships')
  .option('--use-config', 'use parameters from config.ts instead of meta.elo.json')
  .action(async (gameId, player, options) => {
    try {
      await runExplain(gameId, player, options);
    } catch (error) {
      console.error('Error running explain:', error);
      process.exit(1);
    }
  });

const list = program
  .command('list')
  .description('Listing commands');

list
  .command('grinder')
  .description('Print players sorted by most games played')
  .option('-n, --lines <number>', 'number of players to print', (val) => parseInt(val, 10))
  .option('-s, --skip <number>', 'number of players to skip', (val) => parseInt(val, 10))
  .option('--tail', 'display from the tail (bottom) of the list')
  .action(async (options) => {
    try {
      await runListGrinders(options);
    } catch (error) {
      console.error('Error running grinder list:', error);
      process.exit(1);
    }
  });

list
  .command('players')
  .description('Print all players with at least 15 games in alphabetical order')
  .option('-t, --threshold <number>', 'minimum games played threshold', (val) => parseInt(val, 10))
  .action(async (options) => {
    try {
      await runListPlayers(options);
    } catch (error) {
      console.error('Error running player list:', error);
      process.exit(1);
    }
  });

program
  .command('fix')
  .description('Scan source CSV for OCR typos and unknown players')
  .action(async () => {
    try {
      await runFixCommand();
    } catch (error) {
      console.error('Error running fix command:', error);
      process.exit(1);
    }
  });

program.parse();
