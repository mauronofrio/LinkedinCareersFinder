# Linkedin Careers Finder (LinkedIn Jobs – lightweight proxy + UI)

A tiny Node.js backend + static frontend that lets you search public LinkedIn job postings via the `jobs-guest` endpoint and display them with a clean, dark UI.  
It supports multi-select filters, custom “Time Posted” ranges, and a **Load more** button that fetches the next page (offset +10 each time).

> **Disclaimer**: This project calls a **non‑official** LinkedIn endpoint. The structure, availability, and rate limits can change at any time. Use responsibly and review LinkedIn’s Terms of Service before deploying.

---

## Features

- Backend (Express, ESM) that fetches and parses HTML from the public jobs endpoint.
- Frontend (vanilla + Tailwind) with:
  - Keyword, Location, Language (`_l`) and optional `geoId`
  - Multi-select **Workplace**, **Seniority**, **Job type** (values passed as CSV)
  - **Time posted** with predefined periods or **Custom days** → `f_TPR=r<seconds>`
  - “Unused filters” section with **Sort**, **Start (offset)**, **Pages**
  - **Load more**: adds 10 more items per click (until the endpoint returns < 10)
  - Company logos (if available via `data-delayed-url`)
- CORS enabled, compression, Helmet basics.

---

## Quick start (Linux)

Tested with Debian/Ubuntu. Other distros work similarly.

### 1) Install Node.js (20+ recommended)

```bash
# Ubuntu/Debian (use NodeSource for latest LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# verify
node -v
npm -v
```

> The project uses **ESM** modules. Ensure your `package.json` contains `"type": "module"`.

### 2) Get the code

If you haven’t created a repo yet:

```bash
git clone <your-repo-url> careers-finder
cd careers-finder
```

Or copy the provided files into a folder:

```
careers-finder/
├─ package.json
├─ server.js
└─ public/
   └─ index.html
   └─ favicon.ico
```

### 3) Install dependencies

```bash
npm install
```

### 4) Run (dev)

```bash
npm start
# default: http://localhost:3000
```

Serve to your LAN:
- The server binds to `0.0.0.0` (all interfaces). On the same network, visit `http://<your-lan-ip>:3000`.

If you use UFW, allow the port:
```bash
sudo ufw allow 3000/tcp
sudo ufw enable    # only if ufw was disabled and you want it enabled
sudo ufw status
```

> If you changed the port, export it before starting:
> ```bash
> export PORT=8080
> npm start
> ```

## Try it

A limited version is available here: https://www.careers-finder.work/

## License

MIT — do whatever you want, but no warranty. Be mindful of third-party ToS.

