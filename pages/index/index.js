const API_ROOT = "https://data.cityofnewyork.us/resource"

const DATASETS = {
  fhvVehicles: "ym4f-sp8x",
  medallionVehicles: "rhe8-mgbb",
  parkingCameraViolations: "nc67-uf89"
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

function compact(value, fallback = "-") {
  return value === undefined || value === null || value === "" ? fallback : value
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

function mapFhvVehicle(row) {
  const status = row.active === "YES" ? "Active" : compact(row.active, "Unknown")
  return {
    key: `fhv-${row.vehicle_license_number || row.dmv_license_plate_number}`,
    source: "TLC For-Hire Vehicle",
    plate: compact(row.dmv_license_plate_number),
    licenseNumber: compact(row.vehicle_license_number),
    type: compact(row.license_type),
    name: compact(row.name),
    base: row.base_number ? `${row.base_number} · ${compact(row.base_name)}` : compact(row.base_name),
    updated: row.expiration_date ? `到期 ${row.expiration_date.slice(0, 10)}` : compact(row.last_date_updated),
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
    type: compact(row.medallion_type),
    name: compact(row.name),
    base: compact(row.agent_name),
    updated: row.last_updated_date ? `更新 ${row.last_updated_date.slice(0, 10)}` : "-",
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
    plate: "",
    loading: false,
    error: "",
    hasSearched: false,
    vehicles: [],
    violations: [],
    vehicleCount: 0,
    violationCount: 0,
    totalDue: "0.00"
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

      this.setData({
        loading: false,
        vehicles,
        violations,
        vehicleCount: vehicles.length,
        violationCount: violations.length,
        totalDue: totalDue.toFixed(2)
      })
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || "查询失败，请稍后再试。"
      })
    }
  }
})
