const auth = require("../../utils/auth");
const storage = require("../../utils/storage");
const cloudStore = require("../../utils/cloudStore");

Page({
  data: {
    loggedIn: false,
    agreed: false,
    loggingIn: false,
    syncing: false,
    babyName: "宝宝",
    user: null,
    userInitial: "账",
    localCount: 0,
    cloudCount: 0,
    pendingCount: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const session = auth.getSession();
    const photos = storage.getPhotos();
    const cloudCount = photos.filter((photo) => photo.cloudSynced || photo.displayFileId).length;
    this.setData({
      loggedIn: session.loggedIn,
      user: session.user,
      userInitial: session.user ? (session.user.nickName || "账").slice(0, 1) : "账",
      babyName: session.user && session.user.babyName ? session.user.babyName : this.data.babyName,
      localCount: photos.length,
      cloudCount,
      pendingCount: Math.max(photos.length - cloudCount, 0)
    });
  },

  onBabyNameInput(event) {
    this.setData({ babyName: event.detail.value });
  },

  toggleAgreement() {
    this.setData({ agreed: !this.data.agreed });
  },

  async login() {
    if (!this.data.agreed || this.data.loggingIn) {
      return;
    }
    this.setData({ loggingIn: true });
    try {
      let profile = {};
      try {
        const res = await new Promise((resolve, reject) => {
          wx.getUserProfile({
            desc: "用于展示成长账号昵称与头像",
            success: resolve,
            fail: reject
          });
        });
        profile = res.userInfo || {};
      } catch (profileError) {
        console.warn("profile authorization skipped", profileError);
      }

      const result = await auth.login({
        nickName: profile.nickName || "微信用户",
        avatarUrl: profile.avatarUrl || "",
        babyName: this.data.babyName.trim() || "宝宝"
      });
      const cloudPhotos = await cloudStore.pullCloudPhotos();
      storage.mergePhotos(cloudPhotos);
      this.refresh();
      wx.showToast({
        title: result.isNewUser ? "注册成功" : "登录成功",
        icon: "success"
      });
    } catch (error) {
      console.warn("account login failed", error);
      wx.showToast({
        title: error.message === "CLOUD_UNAVAILABLE" ? "请配置正式 AppID" : "登录失败，请重试",
        icon: "none"
      });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  async syncLocalData() {
    if (!auth.isLoggedIn() || this.data.syncing) {
      return;
    }
    const pending = storage.getPhotos().filter((photo) => !photo.cloudSynced && !photo.displayFileId);
    if (!pending.length) {
      return;
    }

    this.setData({ syncing: true });
    let successCount = 0;
    let skippedCount = 0;
    const settings = cloudStore.getStorageSettings();

    for (const photo of pending) {
      const displayPath = photo.compressedPath || photo.path;
      const originalPath = photo.path || displayPath;
      if (!displayPath || displayPath.startsWith("cloud://")) {
        skippedCount += 1;
        continue;
      }
      try {
        const cloudMeta = await cloudStore.uploadPhotoAssets(photo, {
          displayPath,
          originalPath
        }, settings);
        const updated = {
          ...photo,
          ...cloudMeta,
          cloudSynced: Boolean(cloudMeta.displayFileId),
          cloudText: cloudMeta.displayFileId ? "已同步到云端" : "云端待同步"
        };
        await cloudStore.savePhotoMeta({
          ...updated,
          path: "",
          compressedPath: ""
        });
        storage.updatePhoto(photo.id, updated);
        successCount += 1;
      } catch (error) {
        console.warn("sync local photo failed", photo.id, error);
        skippedCount += 1;
      }
    }

    this.setData({ syncing: false });
    this.refresh();
    wx.showToast({
      title: skippedCount ? `同步${successCount}张，${skippedCount}张待重试` : `已同步${successCount}张`,
      icon: skippedCount ? "none" : "success"
    });
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "退出后新增内容只保存在本机，已同步的云端数据不会被删除。",
      confirmText: "退出",
      success: (res) => {
        if (res.confirm) {
          auth.clearSession();
          this.setData({
            loggedIn: false,
            user: null,
            cloudCount: 0,
            pendingCount: storage.getPhotos().length
          });
        }
      }
    });
  }
});
