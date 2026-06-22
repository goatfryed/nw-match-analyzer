import config from '../config.js';

export function resolvePlayerName(name: string): string {
  const cleanName = name.trim();
  const lowerName = cleanName.toLowerCase();
  const aliases = (config as any).aliases || {};

  for (const [mainName, aliasList] of Object.entries(aliases)) {
    if (mainName.toLowerCase() === lowerName) {
      return mainName;
    }
    if (Array.isArray(aliasList)) {
      for (const alias of aliasList) {
        if (alias.toLowerCase() === lowerName) {
          return mainName;
        }
      }
    }
  }
  return cleanName;
}
