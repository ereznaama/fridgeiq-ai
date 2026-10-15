// FridgeIQ — Google Apps Script web app backend.
// Serves the UI and calls the Gemini API (generativelanguage.googleapis.com)
// server-side, so the API key never reaches the browser.

const GEMINI_MODEL = 'gemini-2.0-flash';
const API_KEY_PROPERTY = 'GEMINI_API_KEY';

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

// Used by index.html to show a setup warning when the key isn't set yet.
function hasApiKeyConfigured() {
  return !!PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
}

/**
 * Called from the client via google.script.run.
 * fridgeDataUrl / pantryDataUrl: "data:image/jpeg;base64,...." strings (or null).
 * missingItemsText: comma-separated string typed by the user.
 */
function analyzeImages(fridgeDataUrl, pantryDataUrl, missingItemsText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  const missingItems = (missingItemsText || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

  const parts = [{ text: buildPrompt_(missingItems) }];
  if (fridgeDataUrl) parts.push(toInlineImagePart_(fridgeDataUrl));
  if (pantryDataUrl) parts.push(toInlineImagePart_(pantryDataUrl));

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: {
      responseMimeType: 'application/json',
    },
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

function buildPrompt_(missingItems) {
  return 'את שף עוזר חכם לחיסכון במזון. זהי את כל המצרכים הנראים בתמונות מקרר ומזווה שצורפו. ' +
    'התעלמי לגמרי ממוצרים שמופיעים ברשימת החוסרים הבאה, גם אם הם נראים בתמונה: ' +
    (missingItems.join(', ') || 'אין') + '. ' +
    'סמני true עבור expiringSoon רק למוצרים טריים שבאופן טיפוסי מתקלקלים תוך ימים ספורים ' +
    '(ירקות עלים, עגבניות, שמנת, בשר טרי וכדומה), ותני עדיפות במתכונים למוצרים האלה. ' +
    'החזירי אך ורק JSON תקין, ללא טקסט נוסף, בדיוק בפורמט הבא: ' +
    '{"detectedItems":[{"name":"","expiringSoon":false}],' +
    '"recipes":[{"title":"","description":"","tags":[]}],' +
    '"estimatedSavings":0}';
}

function toInlineImagePart_(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('INVALID_IMAGE_FORMAT');
  return { inlineData: { mimeType: match[1], data: match[2] } };
}
