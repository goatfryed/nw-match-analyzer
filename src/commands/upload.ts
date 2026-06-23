import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';
import { getSheetsClient, getSheetTitle } from '../common/sheets.js';

export async function uploadCsvSheet(type?: string): Promise<void> {
  const targetType = (type || 'matches').toLowerCase();

  if (targetType !== 'matches') {
    throw new Error(`Upload type "${type}" is not supported. Only "matches" is currently supported.`);
  }

  const spreadsheetId = config.sheets?.spreadsheetId;
  const matchSheetId = config.sheets?.matchSheetId;

  if (!spreadsheetId || matchSheetId === undefined) {
    throw new Error('Spreadsheet configurations (sheets.spreadsheetId, sheets.matchSheetId) are missing in config.');
  }

  const matchesCsvPath = path.resolve(process.cwd(), '.tmp/matches.csv');
  if (!fs.existsSync(matchesCsvPath)) {
    throw new Error(`Matches CSV not found at ${matchesCsvPath}. Please run 'calculate' first.`);
  }

  console.log(`Reading matches data from ${matchesCsvPath}...`);
  const fileContent = fs.readFileSync(matchesCsvPath, 'utf8');
  const rows: string[][] = parse(fileContent, {
    skip_empty_lines: true,
    trim: true,
  });

  if (rows.length === 0) {
    console.log('Matches CSV is empty. Nothing to upload.');
    return;
  }

  console.log('Authenticating with Google APIs...');
  const sheetsClient = getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);

  const sheetTitle = await getSheetTitle(sheetsClient, spreadsheetId, matchSheetId);
  const uploadRange = `${sheetTitle}!A:I`;

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

  console.log('✅ Upload complete.');
}
