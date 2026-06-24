const SESSION_KEY = "growth_account_session";

function emptySession() {
  return {
    loggedIn: false,
    user: null
  };
}

function getSession() {
  try {
    const saved = wx.getStorageSync(SESSION_KEY);
    if (!saved || !saved.loggedIn || !saved.user || !saved.user.id) {
      return emptySession();
    }
    return saved;
  } catch (error) {
    console.warn("read account session failed", error);
    return emptySession();
  }
}

function isLoggedIn() {
  return getSession().loggedIn;
}

function setSession(user) {
  const session = {
    loggedIn: true,
    user,
    loggedInAt: new Date().toISOString()
  };
  wx.setStorageSync(SESSION_KEY, session);
  const app = getApp();
  if (app) {
    app.globalData.user = user;
    app.globalData.babyName = user.babyName || "宝宝";
  }
  return session;
}

function clearSession() {
  wx.removeStorageSync(SESSION_KEY);
  const app = getApp();
  if (app) {
    app.globalData.user = null;
    app.globalData.babyName = "宝宝";
  }
}

function login(profile) {
  if (!wx.cloud) {
    return Promise.reject(new Error("CLOUD_UNAVAILABLE"));
  }
  return wx.cloud.callFunction({
    name: "account",
    data: {
      action: "login",
      profile: profile || {}
    }
  }).then((res) => {
    const result = res.result || {};
    if (!result.ok || !result.user) {
      throw new Error(result.message || "LOGIN_FAILED");
    }
    setSession(result.user);
    return result;
  });
}

module.exports = {
  getSession,
  isLoggedIn,
  setSession,
  clearSession,
  login
};
