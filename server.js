require('dotenv').config(); // Load .env variables

const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app       = express();
const PORT      = 3000;
const DATA_FILE   = path.join(__dirname, 'data.json');
const TOKENS_FILE = path.join(__dirname, 'withings_tokens.json');
const LOG_FILE    = path.join(__dirname, 'forge.log');

// ── Logger ────────────────────────────────────────────────────────────────────
// Keeps the last 500 lines in memory for /api/logs, and writes all lines to
// forge.log so they survive server restarts.
const logBuffer = [];
function log(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.join(' ');
  console.log(line);
  logBuffer.push(line);
  if (logBuffer.length > 500) logBuffer.shift();
  if (process.env.NODE_ENV !== 'dev') try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}
// Patch console.error so it goes through the same pipeline
const _origErr = console.error.bind(console);
console.error = (...args) => { log('[ERROR]', ...args); _origErr(...args); };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Withings OAuth2 config
const WITHINGS = {
  clientId:     process.env.WITHINGS_CLIENT_ID,
  clientSecret: process.env.WITHINGS_CLIENT_SECRET,
  redirectUri:  'https://desktop-riari8u.tailca74c1.ts.net/api/withings/callback',
  authUrl:      'https://account.withings.com/oauth2_user/authorize2',
  tokenUrl:     'https://wbsapi.withings.net/v2/oauth2',
  measureUrl:   'https://wbsapi.withings.net/measure',
};

app.use(express.json({ limit: '150mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ──────────────────────────────────────────────────────────────

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE))
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Failed to load data:', e.message); }
  return { foods:{}, exercises:[], sessions:[], weightLog:[], recipes:[], goals:{cal:2000,p:150,c:200,f:65}, bio:{} };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Withings token helpers ────────────────────────────────────────────────────

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE))
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch (e) {}
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// Exchange or refresh tokens via Withings token endpoint
async function requestTokens(params) {
  const body = new URLSearchParams({
    client_id:     WITHINGS.clientId,
    client_secret: WITHINGS.clientSecret,
    ...params,
  });
  const res  = await fetch(WITHINGS.tokenUrl, { method: 'POST', body });
  const json = await res.json();
  if (json.status !== 0) throw new Error('Withings token error: ' + JSON.stringify(json));
  return json.body; // { access_token, refresh_token, expires_in, ... }
}

// Return a valid access token, refreshing if expired
async function getAccessToken() {
  let tokens = loadTokens();
  if (!tokens) throw new Error('Withings not connected');
  // Refresh if the token expires within the next 5 minutes
  if (Date.now() >= tokens.expiresAt - 5 * 60 * 1000) {
    console.log('Refreshing Withings token…');
    const fresh = await requestTokens({
      action:        'requesttoken',
      grant_type:    'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    tokens = {
      accessToken:  fresh.access_token,
      refreshToken: fresh.refresh_token,
      expiresAt:    Date.now() + fresh.expires_in * 1000,
    };
    saveTokens(tokens);
  }
  return tokens.accessToken;
}

// ── Withings sync logic ───────────────────────────────────────────────────────

// Pull weight measurements from Withings and merge into state.weightLog.
// Only adds entries that don't already exist for that date.
async function syncWithings() {
  console.log('Syncing Withings weight data…');
  const accessToken = await getAccessToken();

  // Fetch weight measurements (meastype=1) for the past year
  const since = Math.floor(Date.now() / 1000) - 365 * 24 * 3600;
  const url   = WITHINGS.measureUrl
    + '?action=getmeas&meastype=1&category=1&startdate=' + since
    + '&enddate=' + Math.floor(Date.now() / 1000);

  const res  = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  const json = await res.json();

  if (json.status !== 0) throw new Error('Withings measure error: ' + JSON.stringify(json));

  const data = loadData();
  if (!data.weightLog) data.weightLog = [];

  let added = 0;
  for (const group of json.body.measuregrps || []) {
    const dateStr = new Date(group.date * 1000).toISOString().slice(0, 10);
    // meastype=1 is weight in kg; value * 10^unit gives kg
    const measure = group.measures.find(m => m.type === 1);
    if (!measure) continue;
    const kg  = measure.value * Math.pow(10, measure.unit);
    const lbs = Math.round(kg * 2.20462 * 10) / 10;

    // Skip if we already have an entry for this date
    if (data.weightLog.some(e => e.date === dateStr)) continue;

    data.weightLog.push({ id: group.date, date: dateStr, weight: lbs, source: 'withings' });
    added++;
  }

  if (added > 0) {
    saveData(data);
    console.log('Withings sync: added ' + added + ' new entries.');
  } else {
    console.log('Withings sync: no new entries.');
  }

  // Record the last sync time
  const tokens = loadTokens();
  if (tokens) { tokens.lastSync = new Date().toISOString(); saveTokens(tokens); }
  return added;
}

// ── State endpoints ───────────────────────────────────────────────────────────

// ── Log viewer ───────────────────────────────────────────────────────────────

app.get('/api/logs', (req, res) => {
  const lines = logBuffer.slice(-200); // last 200 lines
  res.send(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Forge logs</title>'
    + '<style>body{background:#0f0f0f;color:#c8f56a;font:13px/1.6 monospace;padding:20px}'
    + 'a{color:#6baeff}pre{white-space:pre-wrap;word-break:break-all}</style></head>'
    + '<body><b>Forge server logs</b> &nbsp; <a href="/api/logs">refresh</a>'
    + ' &nbsp; <a href="/">← home</a><hr>'
    + '<pre>' + lines.map(l => l.replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('\n') + '</pre>'
    + '</body></html>'
  );
});

// ── State endpoints ───────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => res.json(loadData()));

app.put('/api/state', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object')
    return res.status(400).json({ error: 'Invalid data' });
  saveData(data);
  res.json({ ok: true });
});

// ── Withings OAuth endpoints ──────────────────────────────────────────────────

// Step 1 — redirect the browser to Withings login
app.get('/api/withings/auth', (req, res) => {
  const url = WITHINGS.authUrl
    + '?response_type=code'
    + '&client_id='     + encodeURIComponent(WITHINGS.clientId)
    + '&redirect_uri='  + encodeURIComponent(WITHINGS.redirectUri)
    + '&scope=user.metrics'
    + '&state=forge';
  res.redirect(url);
});

// Step 2 — Withings redirects back here with ?code=...
app.get('/api/withings/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code parameter');
  try {
    const tokens = await requestTokens({
      action:       'requesttoken',
      grant_type:   'authorization_code',
      code,
      redirect_uri: WITHINGS.redirectUri,
    });
    saveTokens({
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt:    Date.now() + tokens.expires_in * 1000,
      lastSync:     null,
    });
    // Run an immediate sync then redirect back to the app
    await syncWithings();
    res.redirect('/#weight');
  } catch (e) {
    console.error('Withings callback error:', e);
    res.status(500).send('Withings connection failed: ' + e.message);
  }
});

// Manual sync trigger (also called by the auto-sync timer)
app.post('/api/withings/sync', async (req, res) => {
  try {
    const added = await syncWithings();
    res.json({ ok: true, added });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Returns connection status and last sync time
app.get('/api/withings/status', (req, res) => {
  const tokens = loadTokens();
  res.json({
    connected: !!tokens,
    lastSync:  tokens ? tokens.lastSync : null,
  });
});

// Disconnect — delete stored tokens
app.delete('/api/withings/disconnect', (req, res) => {
  if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
  res.json({ ok: true });
});

// ── USDA food search ─────────────────────────────────────────────────────────

// GET /api/food-search?q=chicken+breast
// Queries USDA FoodData Central and returns up to 8 results with
// standardised cal/p/c/f values per 100 g so the client can display them.
app.get('/api/food-search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const url = 'https://api.nal.usda.gov/fdc/v1/foods/search'
    + '?query='    + encodeURIComponent(q)
    + '&pageSize=8'
    + '&dataType=SR%20Legacy,Foundation,Branded'  // most reliable data types
    + '&api_key='  + process.env.USDA_API_KEY;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('USDA HTTP ' + response.status);
    const data = await response.json();

    // Normalise each result to { name, cal, p, c, f, per } where per is the
    // reference amount (always 100 g for USDA SR/Foundation, may vary for Branded)
    const results = (data.foods || []).map(food => {
      const n = (food.foodNutrients || []);
      const get = (id) => {
        const hit = n.find(x => x.nutrientId === id || x.nutrientNumber === String(id));
        return hit ? Math.round((hit.value || 0) * 10) / 10 : 0;
      };
      return {
        name:   food.description,
        brand:  food.brandOwner || food.brandName || '',
        cal:    Math.round(get(1008) || get(2047)), // Energy kcal
        p:      get(1003),   // Protein
        c:      get(1005),   // Carbohydrates
        f:      get(1004),   // Total Fat
        per:    '100g',
      };
    }).filter(f => f.cal > 0); // drop items with no calorie data

    res.json(results);
  } catch (e) {
    console.error('USDA search error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Recipe from URL ───────────────────────────────────────────────────────────

// Extract candidate image URLs from raw HTML (og:image, twitter:image, <img> tags)
function extractImageUrls(html, baseUrl) {
  const candidates = [];

  // Open Graph / Twitter card (most reliable recipe thumbnail)
  const metaRe = /<meta[^>]+(property|name)=["'](og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']|<meta[^>]*content=["']([^"']+)["'][^>]+(property|name)=["'](og:image(?::secure_url)?|twitter:image)["']/gi;
  let m;
  while ((m = metaRe.exec(html)) !== null) {
    const src = m[3] || m[4];
    if (src && !src.startsWith('data:') && !candidates.includes(src)) candidates.push(src);
  }

  // <img src="..."> — skip icons/logos/tracking pixels/SVG UI elements
  const imgRe = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  while ((m = imgRe.exec(html)) !== null && candidates.length < 12) {
    const src = m[1];
    if (!src || src.startsWith('data:')) continue;
    const lower = src.toLowerCase();
    if (/logo|icon|avatar|button|pixel|tracking|badge|arrow|social|sprite|\.svg/.test(lower)) continue;
    if (!candidates.includes(src)) candidates.push(src);
  }

  // Resolve relative URLs, deduplicate, cap at 6
  try {
    const base = new URL(baseUrl);
    return [...new Set(
      candidates.map(src => { try { return new URL(src, base).href; } catch { return null; } }).filter(Boolean)
    )].slice(0, 6);
  } catch {
    return [...new Set(candidates)].slice(0, 6);
  }
}

app.post('/api/recipe-from-url', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ error: 'url is required' });

  // Step 1: Fetch the page HTML
  let html;
  try {
    log('[recipe-from-url] Fetching:', url);
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ForgeBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!pageRes.ok) throw new Error('HTTP ' + pageRes.status);
    html = await pageRes.text();
    log('[recipe-from-url] Fetched', html.length, 'chars');
  } catch (e) {
    log('[ERROR] [recipe-from-url] Fetch error:', e.message);
    return res.json({ error: 'Could not fetch URL: ' + e.message });
  }

  // Step 2a: Extract candidate image URLs before stripping tags
  const suggestedPhotoUrls = extractImageUrls(html, url);
  log('[recipe-from-url] Found', suggestedPhotoUrls.length, 'candidate image URLs');

  // Step 2b: Strip tags and truncate
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 12000);

  // Step 3: Ask Claude to extract the recipe
  let message;
  try {
    log('[recipe-from-url] Calling Claude... text length:', text.length);
    message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content:
          'Extract the recipe from this webpage text and return ONLY a JSON object — no markdown, no explanation.\n\n'
          + 'Schema:\n'
          + '{ "name": string, "servings": number, "ingredients": [{ "name": string, "amount": string, "cal": number, "p": number, "c": number, "f": number }], "instructions": string, "notes": string, "tags": string[] }\n\n'
          + 'Rules:\n'
          + '- Estimate calories and macros per ingredient based on the amount listed.\n'
          + '- instructions: numbered list as a single string with newlines.\n'
          + '- notes: tips/storage/variations or empty string.\n'
          + '- tags: 2-5 short lowercase tags describing meal type, main protein, diet style, etc. (e.g. ["chicken","high-protein","meal prep","asian"]).\n'
          + '- If no recipe found return { "error": "No recipe found" }.\n\n'
          + 'Webpage text:\n' + text,
      }],
    });
    log('[recipe-from-url] Claude responded, content blocks:', message.content?.length);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('[ERROR] [recipe-from-url] Claude error:', msg);
    return res.json({ error: 'Claude API error: ' + msg });
  }

  // Step 4: Parse Claude's JSON output
  const raw = message.content?.[0]?.text || '';
  log('[recipe-from-url] Raw Claude output (first 200):', raw.slice(0, 200));
  try {
    const recipe = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (recipe.error) return res.json({ error: recipe.error });
    res.json({ ...recipe, _suggestedPhotoUrls: suggestedPhotoUrls });
  } catch (e) {
    log('[ERROR] [recipe-from-url] JSON parse error:', e.message, '| raw:', raw.slice(0, 300));
    res.json({ error: 'Failed to parse Claude response. Raw: ' + raw.slice(0, 200) });
  }
});

// ── Auto-sync Withings every 3 hours ─────────────────────────────────────────

const THREE_HOURS = 3 * 60 * 60 * 1000;
setInterval(async () => {
  const tokens = loadTokens();
  if (!tokens) return; // not connected yet — skip silently
  try { await syncWithings(); }
  catch (e) { console.error('Auto-sync failed:', e.message); }
}, THREE_HOURS);

// Run one sync at startup if already connected from a previous session
(async () => {
  const tokens = loadTokens();
  if (tokens) {
    try { await syncWithings(); }
    catch (e) { console.error('Startup sync failed:', e.message); }
  }
})();

// ─────────────────────────────────────────────────────────────────────────────

// Catch-all error handler — returns JSON instead of crashing or hanging
app.use((err, req, res, next) => {
  log('[ERROR] Unhandled express error:', err.message);
  if (!res.headersSent) res.json({ error: err.message || 'Server error' });
});

// Keep the process alive — log unhandled rejections instead of crashing
process.on('unhandledRejection', (reason) => {
  log('[ERROR] Unhandled rejection:', reason instanceof Error ? reason.message : String(reason));
});
process.on('uncaughtException', (err) => {
  log('[ERROR] Uncaught exception:', err.message);
});

const server = app.listen(PORT, () => {
  log('Forge running at http://localhost:' + PORT);
});

// Increase timeouts for slow/mobile connections coming through Tailscale
server.keepAliveTimeout = 65000;   // ms — longer than most proxy idle timeouts
server.headersTimeout   = 70000;
