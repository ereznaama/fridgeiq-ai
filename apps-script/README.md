# FridgeIQ — גרסת Google Apps Script

גרסה עצמאית של FridgeIQ שרצה כ-Web App דרך Google Apps Script, עם ניתוח תמונות אמיתי מול **Gemini API** (לא דמו). מפתח ה-API נשמר בצד השרת (Script Properties) ולעולם לא נחשף בדפדפן.

## קבצים

| קובץ | תפקיד |
|---|---|
| `Code.gs` | שרת: מגיש את העמוד וקורא ל-Gemini API |
| `index.html` | מבנה העמוד |
| `Stylesheet.html` | העיצוב (CSS) |
| `JavaScript.html` | הלוגיקה בצד הלקוח |
| `appsscript.json` | מניפסט הפרויקט (הרשאות ה-Web App) |

## הקמה — צעד אחר צעד

1. היכנסי ל-**script.google.com** → **New project**.
2. שני את שם הפרויקט (למעלה, "Untitled project") ל-`FridgeIQ`.
3. ב-`Code.gs` הדיפולטיבי — מחקי את התוכן והדביקי את התוכן מהקובץ `Code.gs` כאן.
4. הוסיפי 3 קבצי HTML חדשים (**File → New → HTML file**), כל אחד בשם בדיוק כמו למטה (בלי הסיומת `.html`, עורך ה-Script מוסיף אותה אוטומטית):
   - `index` → הדביקי את תוכן `index.html`
   - `Stylesheet` → הדביקי את תוכן `Stylesheet.html`
   - `JavaScript` → הדביקי את תוכן `JavaScript.html`
5. ב-**Project Settings** (גלגל השיניים בתפריט הצד) — סמני **"Show appsscript.json manifest file in editor"**. קובץ `appsscript.json` ייפתח בעורך; החליפי את תוכנו בתוכן `appsscript.json` כאן.

## הגדרת מפתח ה-Gemini API (בצד השרת, לא בקוד)

1. קבלי מפתח API מ-**aistudio.google.com/apikey** (עם החשבון שכבר יש לך שם).
2. בעורך ה-Apps Script: **Project Settings** (גלגל השיניים) → גללי למטה ל-**Script Properties** → **Add script property**.
3. Property: `GEMINI_API_KEY`
   Value: המפתח שקיבלת מ-AI Studio.
4. שמרי.

ככה המפתח לא נכנס לקוד ולא מגיע לדפדפן של המשתמשים — רק השרת של Apps Script מכיר אותו.

## פריסה (Deploy)

1. **Deploy → New deployment**.
2. לחצי על סמל הגלגל ליד "Select type" ובחרי **Web app**.
3. **Execute as:** Me (את החשבון שלך — כדי שהריצה תהיה על המפתח שלך, לא על חשבון כל משתמש).
4. **Who has access:** **Anyone** — כך שכל מי שיש לו את הקישור יוכל להיכנס בלי להתחבר לחשבון Google (כפי שביקשת).
5. **Deploy**, ואשרי את ההרשאות שתתבקשי (Apps Script יבקש גישה ל-UrlFetch כדי לפנות ל-Gemini).
6. תקבלי כתובת **Web app URL** — זה הקישור העצמאי לאפליקציה. אפשר לשתף אותו לכל מי שתרצי.

כדי לעדכן בעתיד: אחרי שינוי קוד, **Deploy → Manage deployments → ✏️ (עריכה) → Version: New version → Deploy**. אם תפרסמי **New deployment** במקום זה, תקבלי כתובת URL חדשה.

## חשוב לדעת

- **עלות/מכסה:** כל קריאה ל-Gemini (כל סריקה של משתמש) נספרת מול חשבון ה-AI Studio **שלך**, כי `Execute as: Me`. אם הקישור יהיה פתוח לכולם, כדאי לעקוב מדי פעם אחרי השימוש ב-aistudio.google.com.
- **פרטיות:** התמונות שהמשתמש מעלה נשלחות ישירות מהשרת של Apps Script ל-Gemini לצורך הניתוח ולא נשמרות בשום מקום בצד השרת. היסטוריית הסריקות (תמונות ממוזערות + תוצאות) נשמרת רק בדפדפן של המשתמש עצמו (`localStorage`), לא בשרת.
- **מודל:** כרגע מוגדר `gemini-2.0-flash` ב-`Code.gs` (שורה ראשונה, `GEMINI_MODEL`) — אפשר להחליף למודל אחר בכל שלב.
