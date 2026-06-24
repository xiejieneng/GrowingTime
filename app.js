const auth = require("./utils/auth");

App({
  globalData: {
    babyName: "宝宝",
    cloudReady: false,
    user: null
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        traceUser: true
      });
      this.globalData.cloudReady = true;
    }

    const session = auth.getSession();
    this.globalData.user = session.user;
    this.globalData.babyName = session.user && session.user.babyName
      ? session.user.babyName
      : "宝宝";
  }
});
