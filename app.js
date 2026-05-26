App({
  onLaunch() {
    if (wx.cloud) {
      const envId = this.globalData.cloudEnvId
      if (envId) {
        wx.cloud.init({
          env: envId,
          traceUser: true
        })
      }
    }
  },
  globalData: {
    sourceHost: "data.cityofnewyork.us",
    cloudEnvId: ""
  }
})
