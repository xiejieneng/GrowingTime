const { readExif } = require("../../utils/exif");
const { compressPhotoFast } = require("../../utils/image");
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

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
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
    syncing: false,
    queue: []
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

    const tasks = files.map((file) => {
      const id = createId();
      return {
        id,
        file,
        pending: {
          id,
          path: file.tempFilePath,
          statusText: "读取拍摄信息中",
          displayDate: "识别中",
          placeText: "识别中",
          sizeText: formatSize(file.size)
        }
      };
    });
    this.setData({
      processing: true,
      queue: tasks.map((item) => item.pending)
    });

    const processed = await runWithConcurrency(tasks, 3, async ({ id, file }) => {
      try {
        const meta = await readExif(file.tempFilePath);
        this.updateQueue(id, {
          statusText: "快速压缩中",
          displayDate: formatDate(meta.takenAt) || "未知日期",
          placeText: placeText(meta),
          dateUnknown: !meta.takenAt
        });

        const compressed = await compressPhotoFast(file.tempFilePath, {
          quality: this.data.quality,
          maxSide: this.data.maxSideOptions[this.data.maxSideIndex]
        });
        const photo = {
          id,
          path: file.tempFilePath,
          compressedPath: compressed.path,
          createdAt: new Date().toISOString(),
          takenAt: meta.takenAt || "",
          dateSource: meta.takenAt ? "exif" : "unknown",
          latitude: meta.latitude,
          longitude: meta.longitude,
          hasGps: meta.hasGps || false,
          width: compressed.width,
          height: compressed.height,
          originalSize: compressed.originalSize || file.size,
          compressedSize: compressed.compressedSize,
          displaySize: compressed.compressedSize,
          quality: compressed.quality,
          reusedOriginal: compressed.reusedOriginal,
          storageMode: this.data.uploadOriginal ? "backup" : "saving"
        };

        this.updateQueue(id, {
          ...photo,
          statusText: "本地已整理",
          dateUnknown: !photo.takenAt,
          sizeText: compressed.reusedOriginal
            ? `${formatPixels(photo.width, photo.height)} · 原图已是更优体积，直接保留`
            : `${formatPixels(photo.width, photo.height)} · 质量 ${photo.quality}% · 节省 ${Math.max(compressed.ratio, 0)}%`,
          cloudText: auth.isLoggedIn() ? "等待后台同步云端" : "游客模式：仅保存在当前设备"
        });
        return {
          photo,
          originalPath: file.tempFilePath,
          displayPath: compressed.path
        };
      } catch (error) {
        console.warn("process photo failed", error);
        this.updateQueue(id, {
          statusText: "处理失败，已保留原图",
          sizeText: formatSize(file.size)
        });
        return null;
      }
    });

    const saved = processed.filter(Boolean).map((item) => item.photo);
    if (saved.length) {
      storage.addPhotos(saved);
      wx.showToast({
        title: `已整理${saved.length}张`,
        icon: "success"
      });
    }

    this.setData({ processing: false });
    const cloudTasks = processed.filter(Boolean);
    if (auth.isLoggedIn() && cloudTasks.length) {
      this.syncPhotos(cloudTasks).catch((error) => {
        console.warn("background cloud sync failed", error);
      });
    }
  },

  async syncPhotos(tasks) {
    this.setData({ syncing: true });
    try {
      await runWithConcurrency(tasks, 2, async (task) => {
        const latest = storage.getPhotos().find((item) => item.id === task.photo.id) || task.photo;
        this.updateQueue(latest.id, {
          statusText: "本地已整理",
          cloudText: "正在后台同步云端"
        });

        try {
          const cloudMeta = await cloudStore.uploadPhotoAssets(latest, {
            originalPath: task.originalPath,
            displayPath: task.displayPath
          });
          const cloudText = this.buildCloudText(cloudMeta);
          const cloudPhoto = {
            ...latest,
            ...cloudMeta,
            cloudSynced: Boolean(cloudMeta.displayFileId),
            cloudText
          };
          storage.updatePhoto(latest.id, cloudPhoto);
          this.updateQueue(latest.id, {
            ...cloudPhoto,
            statusText: "已整理",
            cloudText
          });
          await cloudStore.savePhotoMeta({
            ...cloudPhoto,
            path: "",
            compressedPath: ""
          });
        } catch (error) {
          console.warn("cloud sync failed", error);
          storage.updatePhoto(latest.id, {
            cloudSynced: false,
            cloudText: "本地已保存，云端同步失败"
          });
          this.updateQueue(latest.id, {
            cloudText: "本地已保存，云端同步失败"
          });
        }
      });
    } finally {
      this.setData({ syncing: false });
    }
  },

  onPhotoDateChange(event) {
    const id = event.currentTarget.dataset.id;
    const date = event.detail.value;
    if (!id || !date) {
      return;
    }
    const takenAt = `${date}T12:00:00`;
    const patch = {
      takenAt,
      dateSource: "manual",
      displayDate: date,
      dateUnknown: false
    };
    storage.updatePhoto(id, {
      takenAt,
      dateSource: "manual"
    });
    this.updateQueue(id, patch);

    const photo = storage.getPhotos().find((item) => item.id === id);
    if (photo && auth.isLoggedIn()) {
      cloudStore.savePhotoMeta({
        ...photo,
        path: "",
        compressedPath: ""
      }).catch((error) => console.warn("update photo date failed", error));
    }
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
