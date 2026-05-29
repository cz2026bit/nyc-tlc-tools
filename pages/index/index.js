const API_ROOT = "https://data.cityofnewyork.us/resource"

const DATASETS = {
  fhvVehicles: "ym4f-sp8x",
  medallionVehicles: "rhe8-mgbb",
  parkingCameraViolations: "nc67-uf89"
}

function getAppConfig() {
  try {
    return getApp().globalData || {}
  } catch (error) {
    return {}
  }
}

function getCloudDatabase() {
  if (!wx.cloud || !wx.cloud.database) return null
  try {
    return wx.cloud.database()
  } catch (error) {
    return null
  }
}

function cleanPlate(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function money(value) {
  const number = Number(value || 0)
  return number.toFixed(2)
}

function cents(value) {
  const number = Number(String(value || "").replace(/[^0-9.-]/g, ""))
  if (!Number.isFinite(number)) return 0
  return Math.round(number * 100)
}

function dollars(value) {
  return (value / 100).toFixed(2)
}

function receiptOverlayText(totalCents) {
  const subtotal = Math.round(totalCents * 0.9)
  const tax = totalCents - subtotal
  return [
    `full wash        ${dollars(subtotal).replace(".00", "")}`,
    "----------------------",
    `Subtotal      ${dollars(subtotal)}`,
    `Sales Tax      ${dollars(tax)}`,
    `Total         ${dollars(totalCents)}`,
    "----------------------",
    `Cash          ${dollars(totalCents)}`
  ].join("\n")
}

function compact(value, fallback = "-") {
  return value === undefined || value === null || value === "" ? fallback : value
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : ""
}

function requestDataset(datasetId, params) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_ROOT}/${datasetId}.json`,
      method: "GET",
      data: params,
      timeout: 15000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(Array.isArray(res.data) ? res.data : [])
          return
        }
        reject(new Error(`NYC Open Data 请求失败 (${res.statusCode})`))
      },
      fail(err) {
        reject(new Error(err.errMsg || "网络请求失败"))
      }
    })
  })
}

async function savePlateSearchRecord(record) {
  const db = getCloudDatabase()
  if (!db) return { ok: false, reason: "cloud_unavailable" }

  const envId = getAppConfig().cloudEnvId
  if (!envId) return { ok: false, reason: "env_missing" }

  try {
    await db.collection("plate_search_logs").add({
      data: {
        plate: record.plate,
        module: "tlc",
        searchedAt: db.serverDate(),
        vehicleCount: record.vehicleCount,
        violationCount: record.violationCount,
        totalDue: record.totalDue,
        status: record.status
      }
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error.message || "save_failed" }
  }
}

function mapFhvVehicle(row) {
  const status = row.active === "YES" ? "Active" : compact(row.active, "Unknown")
  return {
    key: `fhv-${row.vehicle_license_number || row.dmv_license_plate_number}`,
    source: "TLC For-Hire Vehicle",
    plate: compact(row.dmv_license_plate_number),
    licenseNumber: compact(row.vehicle_license_number),
    licenseType: compact(row.license_type),
    vehicleType: compact(row.vehicle_type),
    vehicleYear: compact(row.vehicle_year),
    vin: compact(row.vehicle_vin_number),
    name: compact(row.name),
    baseNumber: compact(row.base_number),
    baseName: compact(row.base_name),
    baseType: compact(row.base_type),
    basePhone: compact(row.base_telephone_number),
    baseAddress: compact(row.base_address),
    baseWebsite: compact(row.website),
    expirationDate: compact(dateOnly(row.expiration_date)),
    updated: compact(`${dateOnly(row.last_date_updated)} ${compact(row.last_time_updated, "")}`.trim()),
    status,
    activeClass: status === "Active" ? "status-active" : "status-other"
  }
}

function mapMedallionVehicle(row) {
  const status = row.current_status === "CUR" ? "Current" : compact(row.current_status, "Unknown")
  return {
    key: `med-${row.license_number || row.dmv_license_plate_number}`,
    source: "TLC Medallion Vehicle",
    plate: compact(row.dmv_license_plate_number),
    licenseNumber: compact(row.license_number),
    licenseType: compact(row.medallion_type),
    vehicleType: compact(row.vehicle_type),
    vehicleYear: compact(row.model_year),
    vin: compact(row.vehicle_vin_number),
    name: compact(row.name),
    baseNumber: "-",
    baseName: compact(row.agent_name),
    baseType: "Medallion Agent",
    basePhone: "-",
    baseAddress: "-",
    baseWebsite: "-",
    expirationDate: compact(dateOnly(row.type)),
    updated: compact(`${dateOnly(row.last_updated_date)} ${compact(row.last_updated_time, "")}`.trim()),
    status,
    activeClass: status === "Current" ? "status-active" : "status-other"
  }
}

function mapViolation(row) {
  return {
    summonsNumber: compact(row.summons_number),
    issueDate: compact(row.issue_date),
    violationTime: compact(row.violation_time),
    violation: compact(row.violation, "Unknown violation"),
    amountDue: money(row.amount_due),
    fineAmount: money(row.fine_amount),
    penaltyAmount: money(row.penalty_amount),
    paymentAmount: money(row.payment_amount),
    agency: compact(row.issuing_agency),
    county: compact(row.county),
    precinct: compact(row.precinct)
  }
}

Page({
  data: {
    currentModule: "",
    plate: "",
    loading: false,
    error: "",
    hasSearched: false,
    vehicles: [],
    violations: [],
    vehicleCount: 0,
    violationCount: 0,
    totalDue: "0.00",
    receiptImage: "",
    receiptTargetTotal: "",
    receiptAmounts: [
      { id: 1, value: "0.00" },
      { id: 2, value: "0.00" }
    ],
    receiptCurrentTotal: "0.00",
    receiptTargetDisplay: "0.00",
    receiptDifference: "0.00",
    receiptDifferencePrefix: "",
    receiptStatus: "上传票据图片并输入最终金额后，可以保存带训练标记的示例图片，仅供训练数据使用。",
    receiptOverlayText: receiptOverlayText(0)
  },

  openModule(event) {
    this.setData({ currentModule: event.currentTarget.dataset.module })
  },

  backHome() {
    this.setData({ currentModule: "" })
  },

  onPlateInput(event) {
    this.setData({ plate: cleanPlate(event.detail.value) })
  },

  async search() {
    const plate = cleanPlate(this.data.plate)

    if (!plate) {
      this.setData({ error: "请输入车牌号。", hasSearched: false })
      return
    }

    this.setData({
      plate,
      loading: true,
      error: "",
      hasSearched: true,
      vehicles: [],
      violations: []
    })

    try {
      const [fhvRows, medallionRows, violationRows] = await Promise.all([
        requestDataset(DATASETS.fhvVehicles, {
          dmv_license_plate_number: plate,
          $limit: 20
        }),
        requestDataset(DATASETS.medallionVehicles, {
          dmv_license_plate_number: plate,
          $limit: 20
        }),
        requestDataset(DATASETS.parkingCameraViolations, {
          plate,
          $limit: 5000,
          $order: "issue_date DESC"
        })
      ])

      const vehicles = [
        ...fhvRows.map(mapFhvVehicle),
        ...medallionRows.map(mapMedallionVehicle)
      ]
      const violations = violationRows.map(mapViolation)
      const totalDue = violations.reduce((sum, item) => sum + Number(item.amountDue || 0), 0)
      const saveResult = await savePlateSearchRecord({
        plate,
        vehicleCount: vehicles.length,
        violationCount: violations.length,
        totalDue: totalDue.toFixed(2),
        status: "success"
      })

      this.setData({
        loading: false,
        vehicles,
        violations,
        vehicleCount: vehicles.length,
        violationCount: violations.length,
        totalDue: totalDue.toFixed(2),
        error:
          saveResult.ok || saveResult.reason === "env_missing"
            ? ""
            : "查询结果已返回，但车牌记录未写入云端数据库。"
      })
    } catch (error) {
      await savePlateSearchRecord({
        plate,
        vehicleCount: 0,
        violationCount: 0,
        totalDue: "0.00",
        status: "failed"
      })
      this.setData({
        loading: false,
        error: error.message || "查询失败，请稍后再试。"
      })
    }
  },

  chooseReceiptImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (file) {
          this.setData({ receiptImage: file.tempFilePath })
        }
      }
    })
  },

  onReceiptTargetInput(event) {
    this.setData({ receiptTargetTotal: event.detail.value }, () => {
      this.updateReceiptTotals()
    })
  },

  onReceiptAmountInput(event) {
    const index = Number(event.currentTarget.dataset.index)
    const receiptAmounts = this.data.receiptAmounts.slice()
    if (!receiptAmounts[index]) return
    receiptAmounts[index] = {
      ...receiptAmounts[index],
      value: event.detail.value
    }
    this.setData({ receiptAmounts }, () => {
      this.updateReceiptTotals()
    })
  },

  addReceiptAmount() {
    const receiptAmounts = this.data.receiptAmounts.concat({
      id: Date.now(),
      value: "0.00"
    })
    this.setData({ receiptAmounts }, () => {
      this.updateReceiptTotals()
    })
  },

  removeReceiptAmount(event) {
    const index = Number(event.currentTarget.dataset.index)
    let receiptAmounts = this.data.receiptAmounts.slice()
    receiptAmounts.splice(index, 1)
    if (!receiptAmounts.length) {
      receiptAmounts = [{ id: Date.now(), value: "0.00" }]
    }
    this.setData({ receiptAmounts }, () => {
      this.updateReceiptTotals()
    })
  },

  updateReceiptTotals() {
    const current = this.data.receiptAmounts.reduce((sum, item) => sum + cents(item.value), 0)
    const target = cents(this.data.receiptTargetTotal)
    const diff = target - current
    this.setData({
      receiptCurrentTotal: dollars(current),
      receiptTargetDisplay: dollars(target),
      receiptDifference: dollars(Math.abs(diff)),
      receiptDifferencePrefix: diff < 0 ? "-" : "",
      receiptOverlayText: receiptOverlayText(target),
      receiptStatus: "图片上的金额已更新，可保存带训练标记的示例图片，仅供训练数据使用。"
    })
  },

  adjustReceiptAmounts() {
    const target = cents(this.data.receiptTargetTotal)
    let receiptAmounts = this.data.receiptAmounts.slice()
    if (!receiptAmounts.length) {
      receiptAmounts = [{ id: Date.now(), value: dollars(target) }]
    }

    const original = receiptAmounts.map((item) => cents(item.value))
    const total = original.reduce((sum, value) => sum + value, 0)
    let adjusted

    if (total <= 0) {
      const base = Math.floor(target / original.length)
      adjusted = original.map(() => base)
    } else {
      adjusted = original.map((value) => Math.floor((value * target) / total))
    }

    const adjustedTotal = adjusted.reduce((sum, value) => sum + value, 0)
    adjusted[adjusted.length - 1] += target - adjustedTotal
    receiptAmounts = receiptAmounts.map((item, index) => ({
      ...item,
      value: dollars(adjusted[index])
    }))
    this.setData({ receiptAmounts }, () => {
      this.updateReceiptTotals()
    })
  }
})
