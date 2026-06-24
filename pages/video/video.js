const storage = require("../../utils/storage");
const auth = require("../../utils/auth");

function createId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

Page({
  data: {
    theme: "宝宝成长回忆",
    styles: ["温暖纪实", "童话绘本", "清新胶片", "生日派对"],
    styleIndex: 0,
    durations: [10, 15, 30],
    durationIndex: 1,
    photos: [],
    selectedCount: 0,
    videos: [],
    creating: false
  },

  onShow() {
    const photos = storage.getPhotos().map((item, index) => ({
      ...item,
      selected: index < 6
    }));
    const videos = storage.getVideos();
    this.setData({
      photos,
      videos,
      selectedCount: photos.filter((item) => item.selected).length
    });
  },

  onThemeInput(event) {
    this.setData({ theme: event.detail.value });
  },

  onStyleChange(event) {
    this.setData({ styleIndex: Number(event.detail.value) });
  },

  onDurationChange(event) {
    this.setData({ durationIndex: Number(event.detail.value) });
  },

  togglePhoto(event) {
    const id = event.currentTarget.dataset.id;
    const photos = this.data.photos.map((item) => item.id === id ? { ...item, selected: !item.selected } : item);
    this.setData({
      photos,
      selectedCount: photos.filter((item) => item.selected).length
    });
  },

  async createVideo() {
    const selected = this.data.photos.filter((item) => item.selected);
    if (!selected.length) {
      wx.showToast({ title: "请选择照片", icon: "none" });
      return;
    }

    this.setData({ creating: true });

    try {
      const cloudPhotos = await this.preparePhotos(selected);
      const payload = {
        theme: this.data.theme || "宝宝成长回忆",
        style: this.data.styles[this.data.styleIndex],
        duration: this.data.durations[this.data.durationIndex],
        photos: cloudPhotos.map((item) => ({
          id: item.id,
          fileID: item.fileID,
          path: item.path,
          takenAt: item.takenAt,
          latitude: item.latitude,
          longitude: item.longitude
        }))
      };
      const result = await this.callCreateVideo(payload);
      const video = {
        id: createId(),
        taskId: result.taskId,
        status: result.status || "queued",
        statusText: result.statusText || "排队中",
        theme: payload.theme,
        style: payload.style,
        duration: payload.duration,
        photoCount: selected.length,
        createdAt: new Date().toISOString()
      };
      storage.addVideo(video);
      this.setData({
        videos: storage.getVideos(),
        creating: false
      });
      wx.showToast({ title: "已提交", icon: "success" });
    } catch (error) {
      console.warn("create video failed", error);
      this.setData({ creating: false });
      wx.showToast({ title: "提交失败", icon: "none" });
    }
  },

  async preparePhotos(photos) {
    if (!wx.cloud || !auth.isLoggedIn()) {
      return photos.map((item) => ({
        ...item,
        path: item.compressedPath || item.path
      }));
    }

    const uploaded = [];
    for (const item of photos) {
      if (item.displayFileId || item.originalFileId) {
        uploaded.push({
          ...item,
          path: item.compressedPath || item.path,
          fileID: item.originalFileId || item.displayFileId
        });
        continue;
      }

      const localPath = item.compressedPath || item.path;
      const ext = localPath.includes(".png") ? "png" : "jpg";
      const session = auth.getSession();
      const cloudPath = `users/${session.user.id}/video-materials/${item.id}_${Date.now()}.${ext}`;
      const res = await wx.cloud.uploadFile({
        cloudPath,
        filePath: localPath
      });
      uploaded.push({
        ...item,
        path: localPath,
        fileID: res.fileID
      });
    }
    return uploaded;
  },

  callCreateVideo(payload) {
    if (!wx.cloud || !auth.isLoggedIn()) {
      return Promise.resolve({
        taskId: `local_${Date.now()}`,
        status: "queued",
        statusText: "本地模拟"
      });
    }

    return wx.cloud.callFunction({
      name: "createVideo",
      data: payload
    }).then((res) => res.result || {});
  },

  goUpload() {
    wx.switchTab({ url: "/pages/upload/upload" });
  }
});
