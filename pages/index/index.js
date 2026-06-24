const storage = require("../../utils/storage");
const cloudStore = require("../../utils/cloudStore");
const auth = require("../../utils/auth");
const { formatDate, monthKey } = require("../../utils/date");

function formatBytes(size) {
  if (!size) {
    return "0MB";
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)}KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

Page({
  data: {
    babyName: "宝宝",
    loggedIn: false,
    accountName: "游客模式",
    accountHint: "照片仅保存在当前设备",
    photoCount: 0,
    albumCount: 0,
    videoCount: 0,
    cloudPhotos: 0,
    storageModeText: "省钱模式：展示图热存储，原图按需备份",
    displaySizeText: "0MB",
    originalSizeText: "0MB",
    savedSizeText: "0MB",
    displayPercent: 0,
    originalPercent: 0,
    recentPhotos: []
  },

  onShow() {
    const app = getApp();
    const photos = storage.getPhotos();
    const videos = storage.getVideos();
    const albums = new Set(photos.map((item) => monthKey(item.takenAt || item.createdAt)));
    const stats = storage.getStorageStats();
    const settings = cloudStore.getStorageSettings();
    const session = auth.getSession();
    const maxBytes = Math.max(stats.originalBytes, stats.displayBytes, 1);

    this.setData({
      babyName: session.user && session.user.babyName ? session.user.babyName : app.globalData.babyName,
      loggedIn: session.loggedIn,
      accountName: session.loggedIn ? (session.user.nickName || "成长账号") : "游客模式",
      accountInitial: session.loggedIn ? (session.user.nickName || "账").slice(0, 1) : "游",
      accountHint: session.loggedIn ? "云端同步已开启" : "照片仅保存在当前设备",
      photoCount: photos.length,
      albumCount: albums.size,
      videoCount: videos.length,
      cloudPhotos: stats.cloudPhotos,
      storageModeText: session.loggedIn
        ? (settings.uploadOriginal ? "高清备份：Wi‑Fi 下额外上传原图" : "省钱模式：展示图热存储，原图按需备份")
        : "游客模式：全部内容仅保存在当前设备",
      displaySizeText: formatBytes(stats.displayBytes),
      originalSizeText: formatBytes(stats.originalBytes),
      savedSizeText: formatBytes(stats.savedBytes),
      displayPercent: Math.max(Math.round(stats.displayBytes / maxBytes * 100), photos.length ? 6 : 0),
      originalPercent: Math.max(Math.round(stats.originalBytes / maxBytes * 100), photos.length ? 6 : 0),
      recentPhotos: photos.slice(0, 4).map((item) => ({
        ...item,
        displayDate: formatDate(item.takenAt || item.createdAt) || "未知日期",
        placeText: item.placeName || (item.hasGps ? "已记录位置" : "未记录位置")
      }))
    });
  },

  goUpload() {
    wx.switchTab({ url: "/pages/upload/upload" });
  },

  goAlbums() {
    wx.switchTab({ url: "/pages/albums/albums" });
  },

  goVideo() {
    wx.switchTab({ url: "/pages/video/video" });
  },

  goAccount() {
    wx.navigateTo({ url: "/pages/account/account" });
  }
});
