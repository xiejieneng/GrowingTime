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
    creating: false,
    refreshing: false,
    managingVideos: false,
    selectedVideoIds: [],
    deletingVideos: false,
    activeVideo: null,
    playerError: ""
  },

  onShow() {
    const storedPhotos = storage.getPhotos();
    const photos = storedPhotos.map((item, index) => ({
      ...item,
      selected: index < 6
    }));
    const migratedVideos = this.migratePreviewRecords(storage.getVideos(), storedPhotos);
    const videos = this.decorateVideos(migratedVideos);
    this.setData({
      photos,
      videos,
      selectedCount: photos.filter((item) => item.selected).length
    });
  },

  migratePreviewRecords(videos, photos) {
    let changed = false;
    const next = videos.map((video) => {
      const isMockTask = /^(mock|local)_/.test(video.taskId || "");
      if (!isMockTask || video.videoFileId || video.videoUrl || (video.previewPhotos && video.previewPhotos.length)) {
        return video;
      }
      const previewPhotos = photos
        .slice(0, video.photoCount || 6)
        .map((photo) => photo.compressedPath || photo.path)
        .filter(Boolean);
      if (!previewPhotos.length) {
        return video;
      }
      changed = true;
      return {
        ...video,
        status: "completed",
        statusText: "预览可播放",
        previewPhotos
      };
    });
    if (changed) {
      storage.saveVideos(next);
    }
    return next;
  },

  decorateVideos(videos) {
    const selected = new Set(this.data.selectedVideoIds);
    return videos.map((video) => ({
      ...video,
      selected: selected.has(video.id),
      playable: Boolean(video.videoFileId || video.videoUrl || (video.previewPhotos && video.previewPhotos.length)),
      previewOnly: !video.videoFileId && !video.videoUrl && Boolean(video.previewPhotos && video.previewPhotos.length),
      completed: video.status === "completed" || video.status === "success",
      failed: video.status === "failed"
    }));
  },

  toggleVideoManage() {
    const managingVideos = !this.data.managingVideos;
    this.setData({
      managingVideos,
      selectedVideoIds: []
    }, () => {
      this.setData({ videos: this.decorateVideos(storage.getVideos()) });
    });
  },

  toggleVideoSelection(event) {
    if (!this.data.managingVideos || this.data.deletingVideos) {
      return;
    }
    const id = event.currentTarget.dataset.id;
    const selected = new Set(this.data.selectedVideoIds);
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    this.setData({
      selectedVideoIds: Array.from(selected)
    }, () => {
      this.setData({ videos: this.decorateVideos(storage.getVideos()) });
    });
  },

  selectAllVideos() {
    const ids = storage.getVideos().map((video) => video.id);
    const selectedVideoIds = this.data.selectedVideoIds.length === ids.length ? [] : ids;
    this.setData({ selectedVideoIds }, () => {
      this.setData({ videos: this.decorateVideos(storage.getVideos()) });
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
      const hasVideoSource = Boolean(result.videoFileId || result.fileID || result.videoUrl);
      const isMockTask = !hasVideoSource && /^(mock|local)_/.test(result.taskId || "");
      const video = {
        id: createId(),
        taskId: result.taskId,
        status: isMockTask ? "completed" : (result.status || "queued"),
        statusText: isMockTask ? "预览可播放" : (result.statusText || "排队中"),
        theme: payload.theme,
        style: payload.style,
        duration: payload.duration,
        photoCount: selected.length,
        previewPhotos: selected.map((item) => item.compressedPath || item.path).filter(Boolean),
        videoFileId: result.videoFileId || result.fileID || "",
        videoUrl: result.videoUrl || "",
        coverFileId: result.coverFileId || "",
        coverUrl: result.coverUrl || "",
        createdAt: new Date().toISOString()
      };
      storage.addVideo(video);
      this.setData({
        videos: this.decorateVideos(storage.getVideos()),
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
    if (!auth.canUseCloud() || !auth.isLoggedIn()) {
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
    if (!auth.canUseCloud() || !auth.isLoggedIn()) {
      return Promise.resolve({
        taskId: `local_${Date.now()}`,
        status: "queued",
        statusText: "本地模拟"
      });
    }

    return wx.cloud.callFunction({
      name: "createVideo",
      data: {
        action: "create",
        ...payload
      }
    }).then((res) => res.result || {});
  },

  async resolveCloudUrl(fileID) {
    if (!fileID) {
      return "";
    }
    if (!fileID.startsWith("cloud://")) {
      return fileID;
    }
    if (!auth.canUseCloud()) {
      throw new Error("CLOUD_UNAVAILABLE");
    }
    const res = await wx.cloud.getTempFileURL({
      fileList: [fileID]
    });
    const file = res.fileList && res.fileList[0];
    if (!file || file.status !== 0 || !file.tempFileURL) {
      throw new Error("VIDEO_URL_FAILED");
    }
    return file.tempFileURL;
  },

  async playVideo(event) {
    if (this.data.managingVideos) {
      this.toggleVideoSelection(event);
      return;
    }
    const id = event.currentTarget.dataset.id;
    const video = storage.getVideos().find((item) => item.id === id);
    const hasPreview = Boolean(video && video.previewPhotos && video.previewPhotos.length);
    if (!video || (!video.videoFileId && !video.videoUrl && !hasPreview)) {
      wx.showToast({ title: "视频尚未生成完成", icon: "none" });
      return;
    }

    wx.showLoading({ title: "加载视频" });
    try {
      const src = video.videoFileId || video.videoUrl
        ? await this.resolveCloudUrl(video.videoFileId || video.videoUrl)
        : "";
      const cover = video.coverFileId || video.coverUrl
        ? await this.resolveCloudUrl(video.coverFileId || video.coverUrl)
        : "";
      const interval = Math.max(Math.round((video.duration || 15) * 1000 / Math.max((video.previewPhotos || []).length, 1)), 1200);
      this.setData({
        activeVideo: {
          ...video,
          src,
          cover,
          previewOnly: !src,
          previewInterval: interval
        },
        playerError: ""
      }, () => {
        if (src) {
          const context = wx.createVideoContext("growthVideo", this);
          context.play();
        }
      });
    } catch (error) {
      console.warn("resolve video url failed", error);
      wx.showToast({ title: "视频加载失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  closePlayer() {
    if (this.data.activeVideo && !this.data.activeVideo.previewOnly) {
      const context = wx.createVideoContext("growthVideo", this);
      context.stop();
    }
    this.setData({
      activeVideo: null,
      playerError: ""
    });
  },

  onPlayerError() {
    this.setData({
      playerError: "播放失败，请刷新任务或稍后重试。"
    });
  },

  async refreshTasks() {
    if (this.data.refreshing) {
      return;
    }
    if (!auth.canUseCloud() || !auth.isLoggedIn()) {
      wx.showToast({ title: "请登录后刷新云端任务", icon: "none" });
      return;
    }

    const pending = storage.getVideos().filter((video) => {
      return video.taskId && !video.videoFileId && !video.videoUrl && video.status !== "failed";
    });
    if (!pending.length) {
      wx.showToast({ title: "没有待刷新的任务", icon: "none" });
      return;
    }

    this.setData({ refreshing: true });
    let completedCount = 0;
    for (const video of pending) {
      try {
        const res = await wx.cloud.callFunction({
          name: "createVideo",
          data: {
            action: "query",
            taskId: video.taskId
          }
        });
        const result = res.result || {};
        const patch = {
          status: result.status || video.status,
          statusText: result.statusText || video.statusText,
          videoFileId: result.videoFileId || result.fileID || video.videoFileId || "",
          videoUrl: result.videoUrl || video.videoUrl || "",
          coverFileId: result.coverFileId || video.coverFileId || "",
          coverUrl: result.coverUrl || video.coverUrl || ""
        };
        storage.updateVideo(video.id, patch);
        if (patch.videoFileId || patch.videoUrl) {
          completedCount += 1;
        }
      } catch (error) {
        console.warn("refresh video task failed", video.taskId, error);
      }
    }
    this.setData({
      videos: this.decorateVideos(storage.getVideos()),
      refreshing: false
    });
    wx.showToast({
      title: completedCount ? `${completedCount}个视频已完成` : "任务状态已刷新",
      icon: completedCount ? "success" : "none"
    });
  },

  confirmDelete(content) {
    return new Promise((resolve) => {
      wx.showModal({
        title: "删除视频记录",
        content,
        confirmText: "删除",
        confirmColor: "#B34136",
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      });
    });
  },

  async deleteCloudVideoFiles(videos) {
    if (!auth.canUseCloud() || !auth.isLoggedIn()) {
      return true;
    }
    const fileList = videos.flatMap((video) => [video.videoFileId, video.coverFileId]).filter((fileID, index, list) => {
      return fileID && fileID.startsWith("cloud://") && list.indexOf(fileID) === index;
    });
    if (!fileList.length) {
      return true;
    }
    try {
      const res = await wx.cloud.deleteFile({ fileList });
      return (res.fileList || []).every((item) => item.status === 0);
    } catch (error) {
      console.warn("delete cloud video files failed", error);
      return false;
    }
  },

  async deleteSelectedVideos() {
    const ids = this.data.selectedVideoIds;
    if (!ids.length || this.data.deletingVideos) {
      return;
    }
    const videos = storage.getVideos().filter((video) => ids.includes(video.id));
    const hasCloudFiles = videos.some((video) => {
      return [video.videoFileId, video.coverFileId].some((fileID) => fileID && fileID.startsWith("cloud://"));
    });
    const confirmed = await this.confirmDelete(
      hasCloudFiles
        ? `将删除选中的 ${videos.length} 条记录，并清理云端视频和封面。此操作不可恢复。`
        : `将删除选中的 ${videos.length} 条记录。外部视频及第三方任务不会被删除。`
    );
    if (!confirmed) {
      return;
    }

    this.setData({ deletingVideos: true });
    if (this.data.activeVideo && ids.includes(this.data.activeVideo.id)) {
      this.closePlayer();
    }
    const cloudDeleted = await this.deleteCloudVideoFiles(videos);
    ids.forEach((id) => storage.removeVideo(id));
    this.setData({
      managingVideos: false,
      selectedVideoIds: [],
      deletingVideos: false
    }, () => {
      this.setData({ videos: this.decorateVideos(storage.getVideos()) });
    });
    wx.showToast({
      title: cloudDeleted ? `已删除${videos.length}条` : "记录已删，云文件待清理",
      icon: cloudDeleted ? "success" : "none"
    });
  },

  goUpload() {
    wx.switchTab({ url: "/pages/upload/upload" });
  }
});
