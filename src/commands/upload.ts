import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';
import { getSheetsClient, getSheetTitle } from '../common/sheets.js';

function getColumnLetter(colCount: number): string {
  let temp = colCount;
  let letter = '';
  while (temp > 0) {
    const modulo = (temp - 1) % 26;
    letter = String.fromCharCode(65 + modulo) + letter;
    temp = Math.floor((temp - modulo) / 26);
  }
  return letter;
}

export async function uploadCsvSheet(type?: string): Promise<void> {
  const targetType = type?.toLowerCase();

  if (targetType && targetType !== 'matches' && targetType !== 'mmr') {
    throw new Error(`Upload type "${type}" is not supported. Only "matches" and "mmr" are currently supported.`);
  }

  const spreadsheetId = config.sheets?.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error('Spreadsheet configuration (sheets.spreadsheetId) is missing in config.');
  }

  const targets: { name: string; sheetId: number | undefined; csvFilename: string }[] = [];

  if (!targetType || targetType === 'matches') {
    targets.push({
      name: 'matches',
      sheetId: config.sheets?.matchSheetId,
      csvFilename: 'matches.csv',
    });
  }

  if (!targetType || targetType === 'mmr') {
    targets.push({
      name: 'mmr',
      sheetId: config.sheets?.mmrSheetId ?? 558216310,
      csvFilename: 'mmr.csv',
    });
  }

  // Validate all targets first
  for (const target of targets) {
    if (target.sheetId === undefined) {
      throw new Error(`Sheet ID configuration for "${target.name}" is missing in config.`);
    }

    const csvPath = path.resolve(process.cwd(), `.tmp/${target.csvFilename}`);
    if (!fs.existsSync(csvPath)) {
      throw new Error(
        `${target.name.toUpperCase()} CSV not found at ${csvPath}. Please run the appropriate calculate/match commands first.`
      );
    }
  }

  console.log('Authenticating with Google APIs...');
  const sheetsClient = getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);

  for (const target of targets) {
    const csvPath = path.resolve(process.cwd(), `.tmp/${target.csvFilename}`);
    console.log(`Reading ${target.name} data from ${csvPath}...`);
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const rows: string[][] = parse(fileContent, {
      skip_empty_lines: true,
      trim: true,
    });

    if (rows.length === 0) {
      console.log(`${target.csvFilename} is empty. Skipping upload.`);
      continue;
    }

    const sheetTitle = await getSheetTitle(sheetsClient, spreadsheetId, target.sheetId!);
    const lastColLetter = getColumnLetter(rows[0].length);
    const uploadRange = `${sheetTitle}!A:${lastColLetter}`;

    console.log(`Clearing existing content in range "${uploadRange}"...`);
    await sheetsClient.spreadsheets.values.clear({
      spreadsheetId,
      range: uploadRange,
    });

    console.log(`Uploading ${rows.length} rows to range "${uploadRange}"...`);
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId,
      range: uploadRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows,
      },
    });
  }

  console.log('✅ Upload complete.');
}
