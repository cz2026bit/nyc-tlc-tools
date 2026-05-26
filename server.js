const http = require("http")
const https = require("https")
const fs = require("fs")
const path = require("path")
const fsp = fs.promises

const publicRoot = __dirname
const dataDir = path.join(__dirname, "data")
const dataFile = path.join(dataDir, "plate-searches.json")

loadEnvFile()

const supabaseUrl = process.env.SUPABASE_URL || ""
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env")
  if (!fs.existsSync(envPath)) return

  const content = fs.readFileSync(envPath, "utf8")
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) return

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) return

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  })
}

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey)
}

async function ensureStore() {
  await fsp.mkdir(dataDir, { recursive: true })
  try {
    await fsp.access(dataFile)
  } catch {
    await fsp.writeFile(dataFile, "[]", "utf8")
  }
}

async function readStore() {
  await ensureStore()
  const raw = await fsp.readFile(dataFile, "utf8")
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function appendSearch(record) {
  if (hasSupabaseConfig()) {
    await appendSearchToSupabase(record)
    return
  }

  const items = await readStore()
  items.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...record,
    createdAt: new Date().toISOString()
  })
  await fsp.writeFile(dataFile, JSON.stringify(items, null, 2), "utf8")
}

function supabaseRequest(method, table, payload) {
  const baseUrl = new URL(supabaseUrl)
  const body = payload ? JSON.stringify(payload) : ""
  const options = {
    hostname: baseUrl.hostname,
    path: `/rest/v1/${table}${method === "GET" ? "?select=*&order=created_at.desc" : ""}`,
    method,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }
  }
  if (body) options.headers["Content-Length"] = Buffer.byteLength(body)

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let data = ""
      response.on("data", (chunk) => {
        data += chunk
      })
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null)
          return
        }
        reject(new Error(data || `Supabase request failed (${response.statusCode})`))
      })
    })
    request.on("error", reject)
    if (body) request.write(body)
    request.end()
  })
}

async function appendSearchToSupabase(record) {
  await supabaseRequest("POST", "plate_search_logs", {
    plate: record.plate,
    module: record.module,
    vehicle_count: record.vehicleCount,
    violation_count: record.violationCount,
    total_due: record.totalDue,
    status: record.status
  })
}

async function readSearches() {
  if (hasSupabaseConfig()) {
    const rows = await supabaseRequest("GET", "plate_search_logs")
    return Array.isArray(rows) ? rows : []
  }
  return readStore()
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  })
  res.end(JSON.stringify(payload))
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  })
  res.end(text)
}

function guessContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8"
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8"
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8"
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8"
  if (filePath.endsWith(".svg")) return "image/svg+xml"
  return "application/octet-stream"
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    })
    res.end()
    return
  }

  if (req.url === "/api/plate-searches" && req.method === "POST") {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
      if (body.length > 1_000_000) req.destroy()
    })
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}")
        const plate = String(payload.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
        if (!plate) {
          sendJson(res, 400, { ok: false, error: "plate_required" })
          return
        }
        await appendSearch({
          plate,
          module: String(payload.module || "tlc"),
          vehicleCount: Number(payload.vehicleCount || 0),
          violationCount: Number(payload.violationCount || 0),
          totalDue: String(payload.totalDue || "0.00"),
          status: String(payload.status || "success")
        })
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || "bad_request" })
      }
    })
    return
  }

  if (req.url === "/api/plate-searches" && req.method === "GET") {
    readSearches()
      .then((items) => sendJson(res, 200, { ok: true, items }))
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message || "read_failed" }))
    return
  }

  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0]
  const filePath = path.join(publicRoot, urlPath)
  fsp.readFile(filePath)
    .then((data) => {
      res.writeHead(200, {
        "Content-Type": guessContentType(filePath),
        "Access-Control-Allow-Origin": "*"
      })
      res.end(data)
    })
    .catch(() => sendText(res, 404, "Not found"))
})

ensureStore()
  .then(() => {
    server.listen(8787, "127.0.0.1", () => {
      console.log("http://127.0.0.1:8787/")
    })
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
