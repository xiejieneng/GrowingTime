const { readExif } = require("../../utils/exif");
const { compressPhoto } = require("../../utils/image");
const storage = require("../../utils/storage");
const cloudStore = require("../../utils/cloudStore");
const auth = require("../../utils/auth");
const { formatDate } = require("../../utils/date");

function createId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatSize(size) {
  if (!size) {
    return "体积未知";
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)}KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function placeText(meta) {
  if (meta.hasGps) {
    return `${meta.latitude.toFixed(4)}, ${meta.longitude.toFixed(4)}`;
  }
  return "未记录位置";
}

function formatPixels(width, height) {
  if (!width || !height) {
    return "像素未知";
  }
  return `${width}×${height}px`;
}

Page({
  data: {
    quality: 92,
    maxSideOptions: [2048, 3072, 4096],
    maxSideIndex: 2,
    uploadOriginal: false,
    loggedIn: false,
    storageModeText: "省钱模式：仅上传展示图和索引",
    processing: false,
    queue: [],
    canvasWidth: 1,
    canvasHeight: 1
  },

  onShow() {
    const settings = cloudStore.getStorageSettings();
    const loggedIn = auth.isLoggedIn();
    this.setData({
      loggedIn,
      uploadOriginal: settings.uploadOriginal,
      storageModeText: loggedIn
        ? (settings.uploadOriginal ? "高清备份：Wi‑Fi 下额外上传原图" : "省钱模式：仅上传展示图和索引")
        : "游客模式：照片仅保存在当前设备"
    });
  },

  onQualityChange(event) {
    this.setData({ quality: event.detail.value });
  },

  onMaxSideChange(event) {
    this.setData({ maxSideIndex: Number(event.detail.value) });
  },

  onOriginalSwitch(event) {
    if (!auth.isLoggedIn()) {
      this.setData({ uploadOriginal: false });
      wx.showModal({
        title: "登录后可使用云备份",
        content: "游客照片只保存在当前设备，注册登录后可同步展示图或原图。",
        confirmText: "去登录",
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: "/pages/account/account" });
          }
        }
      });
      return;
    }
    const uploadOriginal = event.detail.value;
    cloudStore.saveStorageSettings({
      uploadOriginal,
      mode: uploadOriginal ? "backup" : "saving",
      wifiOnlyOriginal: true
    });
    this.setData({
      uploadOriginal,
      storageModeText: uploadOriginal ? "高清备份：Wi‑Fi 下额外上传原图" : "省钱模式：仅上传展示图和索引"
    });
  },

  async chooseImages() {
    if (this.data.processing) {
      return;
    }

    wx.chooseMedia({
      count: 20,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["original"],
      success: async (res) => {
        await this.processFiles(res.tempFiles || []);
      }
    });
  },

  async processFiles(files) {
    if (!files.length) {
      return;
    }

    this.setData({ processing: true, queue: [] });
    const saved = [];

    for (const file of files) {
      const id = createId();
      const pending = {
        id,
        path: file.tempFilePath,
        statusText: "读取拍摄信息中",
        displayDate: "识别中",
        placeText: "识别中",
        sizeText: formatSize(file.size)
      };
      this.setData({ queue: this.data.queue.concat(pending) });

      const meta = await readExif(file.tempFilePath);
      this.updateQueue(id, {
        statusText: "高清压缩中",
        displayDate: formatDate(meta.takenAt) || "未知日期",
        placeText: placeText(meta)
      });

      try {
        const compressed = await compressPhoto(this, file.tempFilePath, {
          quality: this.data.quality,
          maxSide: this.data.maxSideOptions[this.data.maxSideIndex]
        });
        const photo = {
          id,
          path: file.tempFilePath,
          compressedPath: compressed.path,
          createdAt: new Date().toISOString(),
          takenAt: meta.takenAt || new Date().toISOString(),
          latitude: meta.latitude,
          longitude: meta.longitude,
          hasGps: meta.hasGps || false,
          width: compressed.width,
          height: compressed.height,
          originalSize: compressed.originalSize || file.size,
          compressedSize: compressed.compressedSize,
          displaySize: compressed.compressedSize,
          quality: compressed.quality,
          storageMode: this.data.uploadOriginal ? "backup" : "saving"
        };

        const loggedIn = auth.isLoggedIn();
        this.updateQueue(id, {
          statusText: loggedIn ? "上传云存储中" : "保存到本地",
          sizeText: `${formatPixels(photo.width, photo.height)} · ${formatSize(photo.originalSize)} -> ${formatSize(photo.compressedSize)}`
        });

        let cloudMeta = {};
        let cloudText = loggedIn ? "本地已保存，云端待同步" : "游客模式：仅保存在当前设备";
        try {
          cloudMeta = await cloudStore.uploadPhotoAssets(photo, {
            originalPath: file.tempFilePath,
            displayPath: compressed.path
          });
          cloudText = loggedIn ? this.buildCloudText(cloudMeta) : cloudText;
        } catch (cloudError) {
          console.warn("cloud upload failed", cloudError);
        }
        const cloudPhoto = {
          ...photo,
          ...cloudMeta,
          cloudSynced: Boolean(cloudMeta.displayFileId),
          cloudText
        };

        try {
          await cloudStore.savePhotoMeta({
            ...cloudPhoto,
            path: "",
            compressedPath: ""
          });
        } catch (dbError) {
          console.warn("save photo meta failed", dbError);
        }

        saved.push(cloudPhoto);
        this.updateQueue(id, {
          ...cloudPhoto,
          statusText: "已整理",
          displayDate: formatDate(cloudPhoto.takenAt),
          placeText: placeText(cloudPhoto),
          sizeText: `${formatPixels(cloudPhoto.width, cloudPhoto.height)} · 质量 ${cloudPhoto.quality}% · 节省 ${Math.max(compressed.ratio, 0)}%`,
          cloudText
        });
      } catch (error) {
        console.warn("process photo failed", error);
        this.updateQueue(id, {
          statusText: "处理失败，已保留原图",
          sizeText: formatSize(file.size)
        });
      }
    }

    if (saved.length) {
      storage.addPhotos(saved);
      wx.showToast({
        title: `已整理${saved.length}张`,
        icon: "success"
      });
    }

    this.setData({ processing: false });
  },

  updateQueue(id, patch) {
    this.setData({
      queue: this.data.queue.map((item) => item.id === id ? { ...item, ...patch } : item)
    });
  },

  buildCloudText(meta) {
    if (!auth.isLoggedIn()) {
      return "游客模式：仅保存在当前设备";
    }
    if (!auth.canUseCloud()) {
      return "本地模式：请配置正式 AppID 后开启云开发";
    }
    if (meta.originalUploadSkipped) {
      return `已上传展示图；当前网络 ${meta.networkType}，原图等待 Wi‑Fi`;
    }
    if (meta.originalFileId) {
      return "已上传展示图和原图";
    }
    if (meta.displayFileId) {
      return "已上传展示图，原图未备份";
    }
    return "云存储未完成";
  }
});
