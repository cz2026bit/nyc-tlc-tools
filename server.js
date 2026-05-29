const http = require("http")
const https = require("https")
const fs = require("fs")
const path = require("path")
const fsp = fs.promises

const publicRoot = __dirname
const dataDir = path.join(__dirname, "data")
const dataFile = path.join(dataDir, "plate-searches.json")
const serverHost = process.env.HOST || "0.0.0.0"
const serverPort = Number(process.env.PORT || 8787)

loadEnvFile()

const openaiApiKey = process.env.OPENAI_API_KEY || ""
const openaiImageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1"
const openaiImageQuality = process.env.OPENAI_IMAGE_QUALITY || "low"
const supabaseUrl = process.env.SUPABASE_URL || ""
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const flightCache = new Map()

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

function hasOpenAIConfig() {
  return Boolean(openaiApiKey)
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

function fetchText(targetUrl) {
  const url = new URL(targetUrl)
  const client = url.protocol === "http:" ? http : https
  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 Codex Flight Dashboard",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
        }
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = new URL(response.headers.location, targetUrl).toString()
          fetchText(redirectUrl).then(resolve).catch(reject)
          return
        }

        let data = ""
        response.on("data", (chunk) => {
          data += chunk
        })
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(data)
            return
          }
          reject(new Error(`upstream_request_failed_${response.statusCode}`))
        })
      }
    )
    request.on("error", reject)
    request.end()
  })
}

function stripTags(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function formatDateYmd(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function createDateSeries(days) {
  const result = []
  const now = new Date()
  for (let index = days - 1; index >= 0; index -= 1) {
    const item = new Date(now)
    item.setHours(0, 0, 0, 0)
    item.setDate(now.getDate() - index)
    result.push(item)
  }
  return result
}

function formatChartLabel(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    timeZone: "America/New_York"
  }).format(date)
}

function getAirportConfig(code) {
  const normalized = String(code || "").toUpperCase()
  if (normalized === "JFK") {
    return {
      code: "JFK",
      name: "John F. Kennedy International Airport",
      liveUrl: "https://airport-jfk.com/arrivals.php",
      liveRoot: "https://airport-jfk.com",
      flightStatsCode: "JFK"
    }
  }
  if (normalized === "LGA") {
    return {
      code: "LGA",
      name: "LaGuardia Airport",
      liveUrl: "https://laguardia-airport.com/lga-arrivals",
      liveRoot: "https://laguardia-airport.com",
      flightStatsCode: "LGA"
    }
  }
  if (normalized === "EWR") {
    return {
      code: "EWR",
      name: "Newark Liberty International Airport",
      liveUrl: "https://www.airport-ewr.com/newark-arrivals",
      liveRoot: "https://www.airport-ewr.com",
      flightStatsCode: "EWR"
    }
  }
  throw new Error("unsupported_airport")
}

function getArrivalPeriodUrls(airport) {
  return [0, 6, 12, 18].map((period) => {
    const url = new URL(airport.liveUrl)
    url.searchParams.set("tp", String(period))
    return url.toString()
  })
}

function extractJsonArray(source, marker) {
  const endMarker = '],"showCodeshares"'
  const endIndex = source.lastIndexOf(endMarker)
  if (endIndex < 0) return []

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = endIndex; index >= 0; index -= 1) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "]") {
      depth += 1
      continue
    }

    if (char === "[") {
      depth -= 1
      if (depth === 0) {
        const raw = source.slice(index, endIndex + 1)
        try {
          return JSON.parse(raw)
        } catch (error) {
          return []
        }
      }
    }
  }

  return []
}

async function fetchFlightStatsDay(code, date) {
  const airport = getAirportConfig(code)
  const cacheKey = `flightstats:${airport.code}:${formatDateYmd(date)}`
  const cached = flightCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const targetUrl = new URL(`https://www.flightstats.com/v2/flight-tracker/arrivals/${airport.flightStatsCode}`)
  targetUrl.searchParams.set("year", String(date.getFullYear()))
  targetUrl.searchParams.set("month", String(date.getMonth() + 1))
  targetUrl.searchParams.set("date", String(date.getDate()))

  const html = await fetchText(targetUrl.toString())
  const arrivals = extractJsonArray(html, '"arrivals":')
    .filter((item) => item && !item.isCodeshare)
    .map((item) => ({
      flightNumber: `${item.carrier.fs}${item.carrier.flightNumber}`,
      airline: item.carrier.name,
      origin: item.airport && item.airport.city ? item.airport.city : item.airport.fs,
      scheduledDeparture: item.departureTime ? item.departureTime.time24 : "",
      scheduledArrival: item.arrivalTime ? item.arrivalTime.time24 : "",
      sortTime: item.sortTime || "",
      detailPath: item.url || ""
    }))

  const hourly = Array.from({ length: 24 }, () => 0)
  arrivals.forEach((item) => {
    const hour = Number(String(item.scheduledArrival || "").split(":")[0])
    if (!Number.isNaN(hour) && hour >= 0 && hour < 24) {
      hourly[hour] += 1
    }
  })

  const value = {
    date: formatDateYmd(date),
    label: formatChartLabel(date),
    total: arrivals.length,
    hourly
  }
  flightCache.set(cacheKey, { expiresAt: Date.now() + 60_000, value })
  return value
}

function extractInfoValue(section, title) {
  const pattern = new RegExp(
    `${title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}:[\\s\\S]*?<div class="flight-info__infobox-text[^"]*">([\\s\\S]*?)<\\/div>`,
    "i"
  )
  const match = section.match(pattern)
  return match ? stripTags(match[1]) : ""
}

function parseAirportDetailPage(html) {
  const statusMatch = html.match(/<div class="flight-status__title">([\s\S]*?)<\/div>/i)
  const arrivalIndex = html.indexOf('flight-info__title flight-info__title--arr')
  const section = arrivalIndex >= 0 ? html.slice(arrivalIndex, arrivalIndex + 2400) : html
  const timeType = /Actual Arrival Time:/i.test(section) ? "actual" : /Estimated Arrival Time:/i.test(section) ? "estimated" : ""
  const observedArrival = timeType === "actual" ? extractInfoValue(section, "Actual Arrival Time") : extractInfoValue(section, "Estimated Arrival Time")
  const scheduledArrivalMatch = section.match(/Scheduled Arrival Time:\s*([^<]+)/i)
  const status = statusMatch ? stripTags(statusMatch[1]) : ""

  return {
    status,
    terminal: extractInfoValue(section, "Terminal"),
    gate: extractInfoValue(section, "Gate"),
    scheduledArrival: scheduledArrivalMatch ? stripTags(scheduledArrivalMatch[1]) : "",
    estimatedArrival: timeType === "estimated" ? observedArrival : "",
    actualArrival: timeType === "actual" ? observedArrival : /landed/i.test(status) ? observedArrival : ""
  }
}

async function fetchLiveAirportArrivals(code) {
  const airport = getAirportConfig(code)
  const cacheKey = `live:${airport.code}`
  const cached = flightCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const pages = await Promise.all(getArrivalPeriodUrls(airport).map((url) => fetchText(url)))
  const seen = new Set()
  const rows = pages
    .flatMap((html) => html.split('<div class="flight-row">').slice(1))
    .map((chunk) => {
      const originMatch = chunk.match(/flight-col__dest-term">([\s\S]*?)<\/div>/i)
      const timeMatch = chunk.match(/flight-col__hour">([\s\S]*?)<\/div>/i)
      const flightMatch = chunk.match(/flight-col__flight">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/i)
      const terminalMatch = chunk.match(/flight-col__terminal">([\s\S]*?)<\/div>/i)
      const statusMatch = chunk.match(/flight-col__status[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
      const airlineMatch = chunk.match(/flight-col__airline[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
      if (!flightMatch) return null

      const flightNumber = stripTags(flightMatch[2])
      const scheduledArrival = stripTags(timeMatch ? timeMatch[1] : "")
      const detailUrl = new URL(flightMatch[1], airport.liveRoot).toString()
      const rowKey = `${flightNumber}:${scheduledArrival}:${detailUrl}`
      if (seen.has(rowKey)) return null
      seen.add(rowKey)

      return {
        flightNumber,
        detailUrl,
        origin: stripTags(originMatch ? originMatch[1] : ""),
        scheduledArrival,
        terminal: stripTags(terminalMatch ? terminalMatch[1] : ""),
        status: stripTags(statusMatch ? statusMatch[1] : ""),
        airline: stripTags(airlineMatch ? airlineMatch[1] : "")
      }
    })
    .filter(Boolean)

  const enriched = await Promise.all(
    rows.map(async (item, index) => {
      if (index >= 48) {
        return withFallbackArrivalTimes(item)
      }

      try {
        const detailHtml = await fetchText(item.detailUrl)
        const detail = parseAirportDetailPage(detailHtml)
        const fallbackObserved = detail.actualArrival || detail.estimatedArrival || detail.scheduledArrival || item.scheduledArrival
        return {
          ...item,
          status: detail.status || item.status,
          terminal: detail.terminal || item.terminal,
          gate: detail.gate || "",
          scheduledArrival: detail.scheduledArrival || item.scheduledArrival,
          estimatedArrival: detail.estimatedArrival || (/landed/i.test(detail.status || item.status) ? "" : fallbackObserved),
          actualArrival: detail.actualArrival || (/landed/i.test(detail.status || item.status) ? fallbackObserved : "")
        }
      } catch (error) {
        return withFallbackArrivalTimes(item)
      }
    })
  )

  const flights = enriched.sort((a, b) => getArrivalSortMinutes(b) - getArrivalSortMinutes(a))
  const value = {
    updatedAt: new Date().toISOString(),
    flights
  }
  flightCache.set(cacheKey, { expiresAt: Date.now() + 60_000, value })
  return value
}

function getArrivalSortMinutes(item) {
  return toMinutes(item.estimatedArrival || item.actualArrival || item.scheduledArrival)
}

function toMinutes(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (!match) return 0
  let hour = Number(match[1])
  const minute = Number(match[2])
  const suffix = String(match[3] || "").toLowerCase()
  if (suffix === "pm" && hour < 12) hour += 12
  if (suffix === "am" && hour === 12) hour = 0
  return hour * 60 + minute
}

function withFallbackArrivalTimes(item) {
  const isLanded = /landed/i.test(item.status)
  return {
    ...item,
    gate: item.gate || "",
    estimatedArrival: isLanded ? "" : item.estimatedArrival || item.scheduledArrival,
    actualArrival: isLanded ? item.actualArrival || item.scheduledArrival : ""
  }
}

function buildHourlyFromFlights(flights) {
  const hourly = Array.from({ length: 24 }, () => 0)
  flights.forEach((item) => {
    const minutes = getArrivalSortMinutes(item)
    const hour = Math.floor(minutes / 60)
    if (hour >= 0 && hour < 24) {
      hourly[hour] += 1
    }
  })
  return hourly
}

async function buildFlightOverview(code) {
  const airport = getAirportConfig(code)
  const live = await fetchLiveAirportArrivals(airport.code)

  const delayedCount = live.flights.filter((item) => /delay/i.test(item.status)).length
  const landedCount = live.flights.filter((item) => /landed/i.test(item.status)).length
  const hourly = buildHourlyFromFlights(live.flights)

  return {
    airport: airport.code,
    airportName: airport.name,
    updatedAt: live.updatedAt,
    live: {
      total: live.flights.length,
      landed: landedCount,
      delayed: delayedCount,
      flights: live.flights
    },
    today: {
      date: formatDateYmd(new Date()),
      label: "今天",
      total: live.flights.length,
      hourly
    }
  }
}

function guessContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8"
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8"
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8"
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8"
  if (filePath.endsWith(".svg")) return "image/svg+xml"
  return "application/octet-stream"
}

function collectRequestBody(req, limit = 15_000_000) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
      if (body.length > limit) {
        reject(new Error("payload_too_large"))
        req.destroy()
      }
    })
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

function openaiImageEditRequest(payload) {
  const boundary = `----CodexBoundary${Date.now().toString(16)}`
  const chunks = []

  function pushField(name, value) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`))
    chunks.push(Buffer.from(String(value)))
    chunks.push(Buffer.from("\r\n"))
  }

  function pushFile(name, filename, mimeType, buffer) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
      )
    )
    chunks.push(buffer)
    chunks.push(Buffer.from("\r\n"))
  }

  pushField("model", openaiImageModel)
  pushField("prompt", payload.prompt)
  pushField("quality", openaiImageQuality)
  pushField("size", "1024x1024")
  pushFile("image", payload.filename || "input.png", payload.mimeType, payload.imageBuffer)
  chunks.push(Buffer.from(`--${boundary}--\r\n`))

  const requestBody = Buffer.concat(chunks)
  const options = {
    hostname: "api.openai.com",
    path: "/v1/images/edits",
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": requestBody.length
    }
  }

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let data = ""
      response.on("data", (chunk) => {
        data += chunk
      })
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            reject(error)
          }
          return
        }
        let message = data || `OpenAI request failed (${response.statusCode})`
        try {
          const parsed = JSON.parse(data)
          const apiMessage = parsed && parsed.error && parsed.error.message
          if (apiMessage) message = apiMessage
        } catch (error) {}
        if (response.statusCode === 404) {
          message = `${message} 请检查模型名是否正确，或确认账号是否有图片接口权限。`
        }
        if (response.statusCode === 429) {
          message = `${message} 当前图片接口额度不足，通常需要检查 API 余额、速率限制或账号付费状态。`
        }
        reject(new Error(message))
      })
    })
    request.on("error", reject)
    request.write(requestBody)
    request.end()
  })
}

function extractOpenAIImage(response) {
  const images = Array.isArray(response.data) ? response.data : []
  for (const item of images) {
    if (item && item.b64_json) {
      return {
        mimeType: "image/png",
        data: item.b64_json
      }
    }
  }
  return null
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
    collectRequestBody(req, 1_000_000)
      .then(async (body) => {
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
      })
      .catch((error) => {
        sendJson(res, 400, { ok: false, error: error.message || "bad_request" })
      })
    return
  }

  if (req.url === "/api/plate-searches" && req.method === "GET") {
    readSearches()
      .then((items) => sendJson(res, 200, { ok: true, items }))
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message || "read_failed" }))
    return
  }

  if (req.url === "/api/openai-image" && req.method === "POST") {
    if (!hasOpenAIConfig()) {
      sendJson(res, 500, { ok: false, error: "openai_api_key_missing" })
      return
    }

    collectRequestBody(req)
      .then(async (body) => {
        const payload = JSON.parse(body || "{}")
        const prompt = String(payload.prompt || "").trim()
        const mimeType = String(payload.mimeType || "").trim()
        const imageData = String(payload.imageData || "").trim()

        if (!prompt) {
          sendJson(res, 400, { ok: false, error: "prompt_required" })
          return
        }
        if (!mimeType || !imageData) {
          sendJson(res, 400, { ok: false, error: "image_required" })
          return
        }

        const imageBuffer = Buffer.from(imageData, "base64")
        const openaiResponse = await openaiImageEditRequest({
          prompt,
          mimeType,
          imageBuffer,
          filename: "input-image"
        })

        const generatedImage = extractOpenAIImage(openaiResponse)
        if (!generatedImage) {
          sendJson(res, 502, { ok: false, error: "image_not_returned" })
          return
        }

        sendJson(res, 200, {
          ok: true,
          mimeType: generatedImage.mimeType,
          imageData: generatedImage.data
        })
      })
      .catch((error) => {
        sendJson(res, 500, { ok: false, error: error.message || "openai_request_failed" })
      })
    return
  }

  if (req.url.startsWith("/api/flights") && req.method === "GET") {
    const requestUrl = new URL(req.url, "http://127.0.0.1:8787")
    const airport = requestUrl.searchParams.get("airport") || "JFK"
    buildFlightOverview(airport)
      .then((payload) => sendJson(res, 200, { ok: true, ...payload }))
      .catch((error) => {
        const statusCode = error.message === "unsupported_airport" ? 400 : 502
        sendJson(res, statusCode, { ok: false, error: error.message || "flight_fetch_failed" })
      })
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
    server.listen(serverPort, serverHost, () => {
      console.log(`http://127.0.0.1:${serverPort}/`)
      if (serverHost === "0.0.0.0") {
        console.log(`Listening on local network port ${serverPort}`)
      }
    })
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
