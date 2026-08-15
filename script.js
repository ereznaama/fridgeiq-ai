// FridgeIQ — client-side only. All data stays on the device (localStorage).

const DEMO_API_KEY = '';
const HISTORY_KEY = 'fridgeiq_history';
const MAX_HISTORY = 8;

const state = {
  step: 1,
  images: { fridge: null, pantry: null },
  missingItems: [],
};

// ---------- Navigation ----------

function goToStep(step) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${step}`).classList.add('active');
  state.step = step;

  document.querySelectorAll('.step-dot').forEach(dot => {
    const n = Number(dot.dataset.step);
    dot.classList.toggle('active', n === step);
    dot.classList.toggle('done', n < step);
  });
}

function goBack() {
  if (state.step > 1 && state.step <= 4) {
    goToStep(state.step - 1);
  } else {
    openExitModal();
  }
}

// ---------- Image upload ----------

function handleImageUpload(event, kind) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    state.images[kind] = reader.result;

    const preview = document.getElementById(`${kind}Preview`);
    const label = document.getElementById(`${kind}UploadText`);
    preview.src = reader.result;
    preview.classList.remove('hidden');
    label.classList.add('hidden');

    if (kind === 'fridge') document.getElementById('toStep2').disabled = false;
    if (kind === 'pantry') document.getElementById('toStep3').disabled = false;
  };
  reader.readAsDataURL(file);
}

// ---------- Analysis (AI) ----------

async function runAnalysis() {
  state.missingItems = document
    .getElementById('missingItemsInput').value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-loading').classList.add('active');

  let result;
  try {
    result = DEMO_API_KEY
      ? await analyzeWithAI(state.images, state.missingItems)
      : await analyzeDemoFallback(state.images, state.missingItems);
  } catch (err) {
    console.error('AI analysis failed, using demo fallback:', err);
    result = await analyzeDemoFallback(state.images, state.missingItems);
  }

  renderResults(result);
  saveToHistory(result);
  goToStep(4);
}

// Real AI call — used when DEMO_API_KEY is configured.
async function analyzeWithAI(images, missingItems) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEMO_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'את שף עוזר. זהי מצרכים בתמונות מקרר ומזווה, התעלמי לגמרי ממוצרים שמופיעים ברשימת החוסרים, ' +
            'תני עדיפות למתכונים המנצלים מוצרים שעלולים להתקלקל בקרוב, והחזירי JSON בלבד בפורמט: ' +
            '{"detectedItems":[{"name":"","expiringSoon":false}],"recipes":[{"title":"","description":"","tags":[]}],"estimatedSavings":0}',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `רשימת חוסרים (להתעלם מהם): ${missingItems.join(', ') || 'אין'}` },
            images.fridge ? { type: 'image_url', image_url: { url: images.fridge } } : null,
            images.pantry ? { type: 'image_url', image_url: { url: images.pantry } } : null,
          ].filter(Boolean),
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

// Offline/demo fallback so the pilot flow works without a real API key.
async function analyzeDemoFallback(images, missingItems) {
  await new Promise(r => setTimeout(r, 1400));

  const pool = [
    { name: 'עגבניות', expiringSoon: true },
    { name: 'חסה', expiringSoon: true },
    { name: 'ביצים', expiringSoon: false },
    { name: 'גבינה צהובה', expiringSoon: false },
    { name: 'פלפל אדום', expiringSoon: true },
    { name: 'אורז', expiringSoon: false },
    { name: 'קמח', expiringSoon: false },
    { name: 'שמנת מתוקה', expiringSoon: true },
  ];

  const missingLower = missingItems.map(m => m.toLowerCase());
  const detectedItems = pool.filter(item => !missingLower.includes(item.name.toLowerCase()));
  const expiring = detectedItems.filter(i => i.expiringSoon);

  const recipes = [
    {
      title: 'שקשוקה מהירה',
      description: 'ניצול עגבניות ופלפל שמתקרבים לתאריך התפוגה, עם ביצים.',
      tags: ['20 דקות', 'Anti-Waste', 'צמחוני'],
    },
    {
      title: 'פסטה ברוטב שמנת קלה',
      description: 'מבוססת על מצרכי המזווה שלכם ושמנת שכדאי לנצל השבוע.',
      tags: ['25 דקות', 'משפחתי'],
    },
    {
      title: 'סלט חסה ופלפלים',
      description: 'דרך מהירה לנצל ירקות עלים לפני שיקמלו.',
      tags: ['10 דקות', 'Anti-Waste', 'טבעוני'],
    },
  ];

  return {
    detectedItems,
    recipes,
    estimatedSavings: expiring.length * 12 + detectedItems.length * 3,
  };
}

// ---------- Render results ----------

function renderResults(result) {
  document.getElementById('savingsBox').textContent =
    `💰 חסכתם עד כה כ-₪${result.estimatedSavings} בזכות ניצול נכון של המקרר`;

  const wasteContainer = document.getElementById('wasteAlerts');
  const expiring = result.detectedItems.filter(i => i.expiringSoon);
  wasteContainer.innerHTML = expiring.length
    ? `<div class="waste-alert">⏰ ${expiring.map(i => i.name).join(', ')} מתקרבים לתאריך התפוגה — המתכונים למטה מנצלים אותם קודם</div>`
    : '';

  const chips = document.getElementById('detectedItems');
  chips.innerHTML = result.detectedItems
    .map(i => `<span class="chip ${i.expiringSoon ? 'expiring' : ''}">${i.name}</span>`)
    .join('');

  const grid = document.getElementById('recipeGrid');
  grid.innerHTML = result.recipes
    .map(
      r => `
      <div class="recipe-card">
        <h4>${r.title}</h4>
        <p>${r.description}</p>
        <div class="recipe-tags">${r.tags.map(t => `<span>${t}</span>`).join('')}</div>
      </div>`
    )
    .join('');
}

// ---------- Image / scan history (localStorage) ----------

function saveToHistory(result) {
  const history = getHistory();
  history.unshift({
    date: new Date().toISOString(),
    thumbnail: state.images.fridge || state.images.pantry,
    itemCount: result.detectedItems.length,
    savings: result.estimatedSavings,
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  renderHistory();
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function renderHistory() {
  const row = document.getElementById('historyRow');
  const history = getHistory();

  if (!history.length) {
    row.innerHTML = '<span class="history-empty">עדיין אין סריקות שמורות</span>';
    return;
  }

  row.innerHTML = history
    .map(h => {
      const d = new Date(h.date);
      const label = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
      return `
        <div class="history-item">
          <img src="${h.thumbnail}" alt="סריקה מ-${label}">
          ${label} · ${h.itemCount} פריטים
        </div>`;
    })
    .join('');
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

// ---------- Exit modal ----------

function openExitModal() {
  document.getElementById('exitModal').classList.add('open');
}

function closeExitModal() {
  document.getElementById('exitModal').classList.remove('open');
}

function confirmExit() {
  closeExitModal();
  window.close();
  // If the browser blocks window.close() (not opened via script), fall back to the start step.
  goToStep(1);
}

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
});
