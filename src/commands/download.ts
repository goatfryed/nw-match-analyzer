import fs from 'fs';
import path from 'path';
import config from '../../config.js';
import { getSheetsClient, getSheetTitle } from '../common/sheets.js';

function arrayToCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const stringValue = cell === null || cell === undefined ? '' : String(cell);
          if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
        .join(',')
    )
    .join('\n');
}

export async function downloadSourceSheet(): Promise<void> {
  const spreadsheetId = config.sheets?.spreadsheetId;
  const scoreboardSheetId = config.sheets?.scoreboardSheetId;

  if (!spreadsheetId || scoreboardSheetId === undefined) {
    throw new Error('Spreadsheet configurations (sheets.spreadsheetId, sheets.scoreboardSheetId) are missing in config.');
  }

  console.log('Authenticating with Google APIs...');
  const sheetsClient = getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);

  const sheetTitle = await getSheetTitle(sheetsClient, spreadsheetId, scoreboardSheetId);

  console.log(`Fetching data from sheet: "${sheetTitle}"...`);
  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: sheetTitle,
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    console.warn('No data found in the sheet.');
    return;
  }

  console.log(`Fetched ${rows.length} rows. Converting to CSV...`);

  const csvContent = arrayToCsv(rows);

  const tmpDir = path.resolve(process.cwd(), '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const outputPath = path.join(tmpDir, 'source.csv');
  fs.writeFileSync(outputPath, csvContent, 'utf8');
  console.log(`Successfully downloaded and saved to ${outputPath}`);
}
