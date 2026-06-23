import { google } from 'googleapis';

export function getSheetsClient(scopes: string[]) {
  const auth = new google.auth.GoogleAuth({
    scopes,
  });
  return google.sheets({ version: 'v4', auth });
}

export async function getSheetTitle(
  sheetsClient: any,
  spreadsheetId: string,
  sheetId: number
): Promise<string> {
  console.log(`Fetching spreadsheet metadata for ID: ${spreadsheetId}...`);
  const spreadsheet = await sheetsClient.spreadsheets.get({
    spreadsheetId,
  });

  const sheet = spreadsheet.data.sheets?.find(
    (s: any) => s.properties?.sheetId === sheetId
  );

  if (!sheet) {
    throw new Error(`Sheet with ID ${sheetId} not found in spreadsheet.`);
  }

  const sheetTitle = sheet.properties?.title;
  if (!sheetTitle) {
    throw new Error(`Sheet with ID ${sheetId} does not have a valid title.`);
  }

  return sheetTitle;
}
