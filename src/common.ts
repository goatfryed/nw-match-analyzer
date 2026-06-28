import fs from 'fs';
import path from 'path';

export function getBannedPlayers(): Set<string> {
  const banned = new Set<string>();
  const banlistPath = path.resolve(process.cwd(), '.tmp/banned.txt');
  if (fs.existsSync(banlistPath)) {
    const content = fs.readFileSync(banlistPath, 'utf8');
    content
      .split('\n')
      .map(line => {
        const hashIdx = line.indexOf('#');
        const cleanLine = hashIdx !== -1 ? line.substring(0, hashIdx) : line;
        return cleanLine.trim();
      })
      .filter(line => line)
      .forEach(name => {
        banned.add(name.toLowerCase());
      });
  }
  return banned;
}
