const http = require("http")
const fs = require("fs/promises")
const path = require("path")

const publicRoot = __dirname
const dataDir = path.join(__dirname, "data")
const dataFile = path.join(dataDir, "plate-searches.json")

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true })
  try {
    await fs.access(dataFile)
  } catch {
    await fs.writeFile(dataFile, "[]", "utf8")
  }
}

async function readStore() {
  await ensureStore()
  const raw = await fs.readFile(dataFile, "utf8")
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function appendSearch(record) {
  const items = await readStore()
  items.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...record,
    createdAt: new Date().toISOString()
  })
  await fs.writeFile(dataFile, JSON.stringify(items, null, 2), "utf8")
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
    readStore()
      .then((items) => sendJson(res, 200, { ok: true, items }))
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message || "read_failed" }))
    return
  }

  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0]
  const filePath = path.join(publicRoot, urlPath)
  fs.readFile(filePath)
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
