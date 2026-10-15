// FridgeIQ — Google Apps Script web app backend.
//
// Serves the UI, calls the Gemini API for fridge/pantry analysis and
// day-recommendations, and reads/writes a per-user nutrition log to a
// central Google Sheet (created once via setupNutritionSheet()).
//
// Identity: the web app is deployed with access "Anyone" + "Execute as:
// User accessing the web app", so Session.getActiveUser().getEmail()
// reliably identifies who is using the app (requires Google sign-in).
// That also means Sheets/Drive calls run under the VIEWER's own Google
// account, so the nutrition spreadsheet must be shared with every viewer
// (see README) — Script Properties (the Gemini key, the sheet ID) stay
// readable regardless of who is executing.

const GEMINI_MODEL = 'gemini-2.0-flash';
const API_KEY_PROPERTY = 'GEMINI_API_KEY';
const NUTRITION_SHEET_ID_PROPERTY = 'NUTRITION_SHEET_ID';

const SHEET_LOG = 'Log';
const SHEET_USERS = 'Users';
const DEFAULT_CALORIE_GOAL = 2000;
const DEFAULT_PROTEIN_GOAL = 90;

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('FridgeIQ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Lets index.html pull in Stylesheet.html / JavaScript.html as includes.
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------- Setup status (shown as warnings in index.html) ----------

function hasApiKeyConfigured() {
  return !!PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
}

function hasNutritionSheetConfigured() {
  return !!PropertiesService.getScriptProperties().getProperty(NUTRITION_SHEET_ID_PROPERTY);
}

/**
 * Run this ONCE from the Apps Script editor (select it in the function
 * dropdown, click Run) to create the shared nutrition log spreadsheet.
 * After it runs, open the printed URL and share it ("Anyone with the
 * link" or specific family members) with Editor access — every signed-in
 * user needs edit access to log their own meals.
 */
function setupNutritionSheet() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(NUTRITION_SHEET_ID_PROPERTY);
  if (existingId) {
    Logger.log('גיליון התזונה כבר קיים: https://docs.google.com/spreadsheets/d/' + existingId);
    return;
  }

  const ss = SpreadsheetApp.create('FridgeIQ Nutrition Log');

  const log = ss.getSheets()[0];
  log.setName(SHEET_LOG);
  log.appendRow(['Timestamp', 'Email', 'Type', 'DishName', 'Calories', 'Protein', 'Notes']);
  log.setFrozenRows(1);

  const users = ss.insertSheet(SHEET_USERS);
  users.appendRow(['Email', 'CalorieGoal', 'ProteinGoal', 'UpdatedAt']);
  users.setFrozenRows(1);

  props.setProperty(NUTRITION_SHEET_ID_PROPERTY, ss.getId());

  Logger.log('נוצר גיליון חדש: ' + ss.getUrl());
  Logger.log('חשוב: שתפי אותו (כפתור Share) עם כל מי שישתמש באפליקציה, בהרשאת עריכה (Editor) — אחרת הכתיבה מהאפליקציה תיכשל.');
}

// ---------- Fridge / pantry analysis (Gemini) ----------

/**
 * fridgeDataUrl / pantryDataUrl: "data:image/jpeg;base64,...." strings (or null).
 * missingItemsText: comma-separated string typed by the user.
 */
function analyzeImages(fridgeDataUrl, pantryDataUrl, missingItemsText) {
  const missingItems = parseMissingItems_(missingItemsText);
  const parts = [{ text: buildAnalyzePrompt_(missingItems) }];
  appendImageParts_(parts, fridgeDataUrl, pantryDataUrl);
  return callGeminiJson_(parts);
}

function buildAnalyzePrompt_(missingItems) {
  return 'את שף עוזר חכם לחיסכון במזון. זהי את כל המצרכים הנראים בתמונות מקרר ומזווה שצורפו. ' +
    'התעלמי לגמרי ממוצרים שמופיעים ברשימת החוסרים הבאה, גם אם הם נראים בתמונה: ' +
    (missingItems.join(', ') || 'אין') + '. ' +
    'סמני true עבור expiringSoon רק למוצרים טריים שבאופן טיפוסי מתקלקלים תוך ימים ספורים ' +
    '(ירקות עלים, עגבניות, שמנת, בשר טרי וכדומה), ותני עדיפות במתכונים למוצרים האלה. ' +
    'עבור כל מתכון תני גם הערכת קלוריות וחלבון (בגרם) למנה בודדת. ' +
    'החזירי אך ורק JSON תקין, ללא טקסט נוסף, בדיוק בפורמט הבא: ' +
    '{"detectedItems":[{"name":"","expiringSoon":false}],' +
    '"recipes":[{"title":"","description":"","tags":[],"estCalories":0,"estProtein":0}],' +
    '"estimatedSavings":0}';
}

// ---------- Recommendations for the rest of the day (Gemini + nutrition log) ----------

function getDayRecommendations(fridgeDataUrl, pantryDataUrl, missingItemsText) {
  const missingItems = parseMissingItems_(missingItemsText);
  const log = getTodayLog();

  const parts = [{ text: buildDayPrompt_(missingItems, log) }];
  appendImageParts_(parts, fridgeDataUrl, pantryDataUrl);

  const result = callGeminiJson_(parts);
  result.remaining = log.remaining;
  return result;
}

function buildDayPrompt_(missingItems, log) {
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
  return 'את דיאטנית ושפית חכמה. למשתמש נותר היום תקציב של ' + log.remaining.calories +
    ' קלוריות ו-' + log.remaining.protein + ' גרם חלבון (מתוך יעד יומי של ' + log.goals.calorieGoal +
    ' קלוריות ו-' + log.goals.proteinGoal + ' גרם חלבון; עד כה היום נצרכו ' + log.totals.calories +
    ' קלוריות ו-' + log.totals.protein + ' גרם חלבון). השעה כעת ' + now + '. ' +
    'בהתבסס על המצרכים הנראים בתמונות המקרר/מזווה שצורפו (אם צורפו; אחרת הציעי לפי מצרכים ביתיים נפוצים), ' +
    'התעלמי ממוצרים ברשימת החוסרים: ' + (missingItems.join(', ') || 'אין') + '. ' +
    'הציעי 3 עד 4 מנות אפשריות להמשך היום שמתאימות לתקציב הקלורי והחלבון שנותר, ' +
    'בסדר עדיפות למנות עם יחס חלבון-לקלוריה גבוה. ' +
    'החזירי אך ורק JSON תקין, ללא טקסט נוסף, בדיוק בפורמט הבא: ' +
    '{"recommendations":[{"title":"","description":"","estCalories":0,"estProtein":0,"tags":[]}]}';
}

// ---------- Nutrition log (Google Sheet, per signed-in user) ----------

function getUserGoals() {
  const email = getCurrentUserEmail_();
  const sheet = getNutritionSpreadsheet_().getSheetByName(SHEET_USERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      return { email: email, calorieGoal: Number(data[i][1]), proteinGoal: Number(data[i][2]) };
    }
  }
  return { email: email, calorieGoal: DEFAULT_CALORIE_GOAL, proteinGoal: DEFAULT_PROTEIN_GOAL };
}

function setUserGoals(calorieGoal, proteinGoal) {
  const email = getCurrentUserEmail_();
  const sheet = getNutritionSpreadsheet_().getSheetByName(SHEET_USERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[calorieGoal, proteinGoal, new Date()]]);
      return getTodayLog();
    }
  }
  sheet.appendRow([email, calorieGoal, proteinGoal, new Date()]);
  return getTodayLog();
}

function logMeal(entry) {
  const email = getCurrentUserEmail_();
  const sheet = getNutritionSpreadsheet_().getSheetByName(SHEET_LOG);
  sheet.appendRow([
    new Date(),
    email,
    (entry && entry.type) || 'manual',
    (entry && entry.dishName) || '',
    Number(entry && entry.calories) || 0,
    Number(entry && entry.protein) || 0,
    (entry && entry.notes) || '',
  ]);
  return getTodayLog();
}

function getTodayLog() {
  const email = getCurrentUserEmail_();
  const sheet = getNutritionSpreadsheet_().getSheetByName(SHEET_LOG);
  const data = sheet.getDataRange().getValues();
  const timeZone = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');

  const entries = [];
  let totalCalories = 0;
  let totalProtein = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDate = new Date(row[0]);
    if (row[1] === email && Utilities.formatDate(rowDate, timeZone, 'yyyy-MM-dd') === todayStr) {
      const calories = Number(row[4]) || 0;
      const protein = Number(row[5]) || 0;
      entries.push({
        time: Utilities.formatDate(rowDate, timeZone, 'HH:mm'),
        type: row[2],
        dishName: row[3],
        calories: calories,
        protein: protein,
      });
      totalCalories += calories;
      totalProtein += protein;
    }
  }

  const goals = getUserGoalsRaw_(email);
  return {
    entries: entries,
    totals: { calories: totalCalories, protein: totalProtein },
    goals: { calorieGoal: goals.calorieGoal, proteinGoal: goals.proteinGoal },
    remaining: {
      calories: Math.max(0, goals.calorieGoal - totalCalories),
      protein: Math.max(0, goals.proteinGoal - totalProtein),
    },
  };
}

// Same lookup as getUserGoals() but takes an already-known email, so
// getTodayLog() doesn't call getCurrentUserEmail_() (and open the
// spreadsheet) a second time.
function getUserGoalsRaw_(email) {
  const sheet = getNutritionSpreadsheet_().getSheetByName(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      return { calorieGoal: Number(data[i][1]), proteinGoal: Number(data[i][2]) };
    }
  }
  return { calorieGoal: DEFAULT_CALORIE_GOAL, proteinGoal: DEFAULT_PROTEIN_GOAL };
}

// ---------- Export this user's log as a real .xlsx file ----------

function exportMyLogAsXlsx() {
  const email = getCurrentUserEmail_();
  const sheet = getNutritionSpreadsheet_().getSheetByName(SHEET_LOG);
  const data = sheet.getDataRange().getValues();

  const rows = [data[0]];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === email) rows.push(data[i]);
  }

  const tempSs = SpreadsheetApp.create('FridgeIQ-Export-' + email);
  const tempSheet = tempSs.getSheets()[0];
  tempSheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  SpreadsheetApp.flush();

  const fileId = tempSs.getId();
  const blob = DriveApp.getFileById(fileId).getAs(MimeType.MICROSOFT_EXCEL);
  const base64 = Utilities.base64Encode(blob.getBytes());
  DriveApp.getFileById(fileId).setTrashed(true); // keep Drive clean — only the bytes are returned

  return { base64: base64, filename: 'FridgeIQ-' + email.split('@')[0] + '.xlsx' };
}

// ---------- Shared helpers ----------

function getCurrentUserEmail_() {
  const email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('MISSING_USER_EMAIL');
  return email;
}

function getNutritionSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(NUTRITION_SHEET_ID_PROPERTY);
  if (!id) throw new Error('MISSING_NUTRITION_SHEET');
  return SpreadsheetApp.openById(id);
}

function parseMissingItems_(missingItemsText) {
  return (missingItemsText || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function appendImageParts_(parts, fridgeDataUrl, pantryDataUrl) {
  if (fridgeDataUrl) parts.push(toInlineImagePart_(fridgeDataUrl));
  if (pantryDataUrl) parts.push(toInlineImagePart_(pantryDataUrl));
}

function toInlineImagePart_(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('INVALID_IMAGE_FORMAT');
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

function callGeminiJson_(parts) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
  if (!apiKey) throw new Error('MISSING_API_KEY');

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: { responseMimeType: 'application/json' },
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const body = JSON.parse(response.getContentText());

  if (status !== 200) {
    const message = (body.error && body.error.message) || ('HTTP ' + status);
    throw new Error('GEMINI_ERROR: ' + message);
  }

  const text = body.candidates[0].content.parts[0].text;
  return JSON.parse(text);
}
