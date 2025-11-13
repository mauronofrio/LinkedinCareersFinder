import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadHTML } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Se usi un reverse proxy (es. Nginx) sulla VPS:
app.set("trust proxy", true);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.static(path.join(__dirname, "public"))); // serve index.html

const BASE = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";

/* ------------ RATE LIMIT / IP ------------ */

const RATE_LIMIT_MAX = 10;                     // max richieste consentite
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;   // 1 ora
const rateLimitMap = new Map();                // ip -> { count, windowStart }

function getClientIp(req) {
  const xfwd = req.headers["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length > 0) {
    // x-forwarded-for può avere una lista di IP "client, proxy1, proxy2"
    return xfwd.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "unknown";
}

// Middleware di rate limit SOLO per /api/search
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/search")) {
    return next();
  }

  const ip = getClientIp(req);
  const now = Date.now();

  let entry = rateLimitMap.get(ip);

  // Se non esiste o la finestra è scaduta, resettiamo
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
  }

  entry.count += 1;
  rateLimitMap.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX) {
    const resetAt = entry.windowStart + RATE_LIMIT_WINDOW_MS;
    const retryAfterMs = resetAt - now;

    const retryAfterSeconds = Math.max(1, Math.round(retryAfterMs / 1000));
    const mins = Math.floor(retryAfterSeconds / 60);
    const secs = retryAfterSeconds % 60;

    const blockUntilDate = new Date(resetAt);
    const blockUntilLocal = blockUntilDate.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    return res.status(429).json({
      error: "RATE_LIMITED",
      message: `You have exceeded the limit of ${RATE_LIMIT_MAX} requests per hour from this IP. ` +
               `You can try again in ${mins} min ${secs} sec (until ${blockUntilLocal}).`,
      retryAfterSeconds,
      blockUntil: blockUntilDate.toISOString()
    });
  }

  next();
});

/* ------------ headers/fetch helper ------------ */
function makeHeaders(lang = "en_US", refererQS = "") {
  const acceptLang = lang.replace("_", "-") + ",en;q=0.8";
  const cookieLang = "lang=v=2&lang=" + lang.replace("_", "-");
  const referer = refererQS
    ? `https://www.linkedin.com/jobs/search/?${refererQS}`
    : "https://www.linkedin.com/jobs/search/";

  return {
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": acceptLang,
    // "Cookie": cookieLang,
    "priority":"u=0, i",
    "Referer": referer,
    "sec-ch-ua":'"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
    "sec-ch-ua-mobile":"?0",
    "sec-ch-ua-platform":'"Windows"',
    "sec-fetch-dest":"document",
    "sec-fetch-mode":"navigate",
    "sec-fetch-site":"same-origin",
    "sec-fetch-user":"?1",
    "upgrade-insecure-requests":"1",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
    // "X-Requested-With": "XMLHttpRequest"
  };
}

async function getHTML(url, lang = "en_US", refererQS = "") {
  const res = await fetch(url, {
    redirect: "follow",
    headers: makeHeaders(lang, refererQS)
  });
  const text = await res.text();
  console.error(`[LL] GET ${url} -> HTTP ${res.status}, bytes=${text.length}`);
  if (!res.ok) return "";
  return text;
}

/* ------------ parser (cheerio + fallback regex) ------------ */
function parseJobs(html) {
  const out = [];
  if (!html) return out;
  const strip = (s = "") => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

  try {
    const $ = loadHTML(html);

    const cards = $(".base-card.job-search-card, li:has(.base-card.job-search-card)").toArray();
    for (const el of cards) {
      const c = $(el).hasClass("base-card") ? $(el) : $(el).find(".base-card.job-search-card").first();

      // id
      let id = "";
      const urn = c.attr("data-entity-urn") || c.find("[data-entity-urn]").attr("data-entity-urn") || "";
      const um = urn.match(/jobPosting:(\d+)/);
      if (um) id = um[1];

      // link
      let a = c.find("a.base-card__full-link[href*='/jobs/view/']").first();
      if (!a.length) a = c.find("a[href*='/jobs/view/']").first();
      if (!a.length) continue;

      let link = a.attr("href") || "";
      if (!link) continue;
      if (!link.startsWith("http")) link = "https://www.linkedin.com" + link;
      link = link.split("?")[0];

      // id from URL if missing
      if (!id) {
        const mm = link.match(/\/jobs\/view\/(\d+)/);
        if (!mm) continue;
        id = mm[1];
      }

      // title
      let title =
        c.find("h3.base-search-card__title").first().text().trim() ||
        a.find(".sr-only, .visually-hidden").first().text().trim() ||
        "";

      // company
      let company =
        c.find(".base-search-card__subtitle .hidden-nested-link, .base-search-card__subtitle, .job-search-card__subtitle")
          .first()
          .text()
          .trim() || "";

      // location
      let location =
        c.find(".job-search-card__location, .job-card-container__metadata-item")
          .first()
          .text()
          .trim() || "";

      // date
      const date = c.find("time").first().attr("datetime") || "";

      // logo: SOLO data-delayed-url
      let logo = "";
      const img = c.find(".search-entity-media img").first();
      if (img && img.length) {
        logo = img.attr("data-delayed-url") || "";
      }

      out.push({ id, title: strip(title), company: strip(company), location: strip(location), date, url: link, logo });
    }

    if (out.length) {
      const map = new Map(out.map(j => [j.id, j]));
      return [...map.values()];
    }
  } catch {
    // fallback
  }

  // Fallback REGEX (logo = solo data-delayed-url)
  const jobs = [];
  const parts = html.split(/<div[^>]+class=["'][^"']*base-card[^"']*job-search-card[^"']*["'][^>]*data-entity-urn=/i);
  for (let i = 1; i < parts.length; i++) {
    const chunk = 'data-entity-urn=' + parts[i];

    const idm = chunk.match(/jobPosting:(\d+)/);
    const id = idm ? idm[1] : "";

    let link = "";
    const lm = chunk.match(/<a[^>]*class=["'][^"']*base-card__full-link[^"']*["'][^>]*href=["']([^"']*\/jobs\/view\/[^"']*)["']/i)
          || chunk.match(/<a[^>]*href=["']([^"']*\/jobs\/view\/[^"']*)["']/i);
    if (lm) {
      link = lm[1].startsWith("http") ? lm[1] : "https://www.linkedin.com" + lm[1];
      link = link.split("?")[0];
    }

    if (!id || !link) continue;

    let title = "";
    const t1 = chunk.match(/<h3[^>]*class=["'][^"']*base-search-card__title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i);
    const t2 = chunk.match(/<span[^>]*class=["'][^"']*(sr-only|visually-hidden)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    if (t1) title = t1[1]; else if (t2) title = t2[2];

    let company = "";
    const c1 = chunk.match(/<h4[^>]*class=["'][^"']*base-search-card__subtitle[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h4>/i)
           || chunk.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    if (c1) company = c1[1];

    let location = "";
    const l1 = chunk.match(/<span[^>]*class=["'][^"']*job-search-card__location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
           || chunk.match(/<div[^>]*class=["'][^"']*job-search-card__location[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (l1) location = l1[1];

    let date = "";
    const d1 = chunk.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i);
    if (d1) date = d1[1];

    let logo = "";
    const im = chunk.match(/<img[^>]+data-delayed-url=["']([^"']+)["'][^>]*>/i);
    if (im) logo = im[1];

    jobs.push({ id, title: strip(title), company: strip(company), location: strip(location), date, url: link, logo });
  }

  const map = new Map(jobs.map(j => [j.id, j]));
  return [...map.values()];
}

/* ------------ API ------------ */
app.get("/api/search", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");

  const {
    keywords = "",
    location = "",
    _l = "en_US",
    start = "0",
    pages = "1",
    geoId,
    f_WT, // CSV allowed
    f_TPR,
    f_E,  // CSV allowed
    f_JT, // CSV allowed
    sortBy
  } = req.query;

  const perPage = 25;
  const pagesNum = Math.max(1, Math.min(10, parseInt(pages || "1", 10)));
  const startNum = Math.max(0, parseInt(start || "0", 10));

  const refParams = new URLSearchParams();
  if (keywords) refParams.set("keywords", keywords);
  if (location) refParams.set("location", location);
  if (sortBy)   refParams.set("sortBy", sortBy);
  if (geoId)    refParams.set("geoId", geoId);
  for (const [k, v] of Object.entries({ f_WT, f_TPR, f_E, f_JT })) {
    if (v) refParams.set(k, v);
  }
  const refererQS = refParams.toString();

  const pass = { geoId, f_WT, f_TPR, f_E, f_JT, sortBy };
  const all = [];

  for (let i = 0; i < pagesNum; i++) {
    const qs = new URLSearchParams();
    if (keywords) qs.set("keywords", keywords);
    if (location) qs.set("location", location);
    if (geoId)    qs.set("geoId", geoId);
    qs.set("start", String(startNum + i * perPage));
    qs.set("_l", String(_l));
    for (const [k, v] of Object.entries(pass)) if (v) qs.set(k, v);

    const url = `${BASE}?${qs.toString()}`;
    const html = await getHTML(url, String(_l), refererQS);
    if (!html) break;

    const part = parseJobs(html);
    all.push(...part);

    await new Promise(r => setTimeout(r, 350));
  }

  const map = new Map(all.map(j => [j.id, j]));
  res.json([...map.values()]);
});

/* ------------ START ------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
