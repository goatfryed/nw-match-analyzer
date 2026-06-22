import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import config from '../../config.js';

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
  const { spreadsheetId, sourceSheetId } = config;

  console.log('Authenticating with Google APIs...');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`Fetching spreadsheet metadata for ID: ${spreadsheetId}...`);
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const sheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.sheetId === sourceSheetId
  );

  if (!sheet) {
    throw new Error(`Sheet with ID ${sourceSheetId} not found in spreadsheet.`);
  }

  const sheetTitle = sheet.properties?.title;
  if (!sheetTitle) {
    throw new Error(`Sheet with ID ${sourceSheetId} does not have a valid title.`);
  }

  console.log(`Fetching data from sheet: "${sheetTitle}"...`);
  const response = await sheets.spreadsheets.values.get({
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
