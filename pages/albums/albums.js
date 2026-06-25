const storage = require("../../utils/storage");
const cloudStore = require("../../utils/cloudStore");
const auth = require("../../utils/auth");
const { formatDate, monthKey, photoTakenAt } = require("../../utils/date");

function placeText(photo) {
  if (photo.placeName) {
    return photo.placeName;
  }
  if (photo.hasGps && typeof photo.latitude === "number" && typeof photo.longitude === "number") {
    return `${photo.latitude.toFixed(4)}, ${photo.longitude.toFixed(4)}`;
  }
  return "未记录位置";
}

Page({
  data: {
    groups: [],
    photoCount: 0,
    managing: false,
    selectedPhotoIds: [],
    deleting: false
  },

  onShow() {
    this.refreshGroups();
  },

  refreshGroups(photos = storage.getPhotos()) {
    const selected = new Set(this.data.selectedPhotoIds);
    const grouped = photos.reduce((acc, photo) => {
      const actualTakenAt = photoTakenAt(photo);
      const month = monthKey(actualTakenAt);
      if (!acc[month]) {
        acc[month] = [];
      }
      acc[month].push({
        ...photo,
        selected: selected.has(photo.id),
        displayDate: formatDate(actualTakenAt) || "未知日期",
        placeText: placeText(photo)
      });
      return acc;
    }, {});

    const groups = Object.keys(grouped).map((month) => ({
      month,
      photos: grouped[month]
    }));

    this.setData({ groups, photoCount: photos.length });
  },

  previewPhoto(event) {
    if (this.data.managing) {
      this.togglePhotoSelection(event);
      return;
    }
    const current = event.currentTarget.dataset.src;
    const urls = this.data.groups.flatMap((group) => group.photos.map((photo) => photo.compressedPath || photo.path));
    wx.previewImage({
      current,
      urls
    });
  },

  toggleManage() {
    const managing = !this.data.managing;
    this.setData({
      managing,
      selectedPhotoIds: []
    }, () => this.refreshGroups());
  },

  togglePhotoSelection(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.deleting) {
      return;
    }
    const selected = new Set(this.data.selectedPhotoIds);
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    this.setData({
      selectedPhotoIds: Array.from(selected)
    }, () => this.refreshGroups());
  },

  selectAll() {
    const allIds = storage.getPhotos().map((photo) => photo.id);
    const selectedPhotoIds = this.data.selectedPhotoIds.length === allIds.length ? [] : allIds;
    this.setData({ selectedPhotoIds }, () => this.refreshGroups());
  },

  confirmDelete(hasCloudFiles, count) {
    return new Promise((resolve) => {
      wx.showModal({
        title: "删除照片",
        content: hasCloudFiles
          ? `将删除选中的 ${count} 张照片，并清理云端图片和索引。此操作不可恢复。`
          : `将删除选中的 ${count} 张照片及本地记录。此操作不可恢复。`,
        confirmText: "删除",
        confirmColor: "#B34136",
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      });
    });
  },

  removeSavedFile(filePath) {
    if (!filePath || !filePath.startsWith("wxfile://")) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wx.removeSavedFile({
        filePath,
        complete: resolve
      });
    });
  },

  async deleteCloudPhoto(photo) {
    if (!auth.canUseCloud() || !auth.isLoggedIn()) {
      return true;
    }
    let success = true;
    const fileList = [photo.displayFileId, photo.originalFileId].filter((fileID, index, list) => {
      return fileID && fileID.startsWith("cloud://") && list.indexOf(fileID) === index;
    });
    if (fileList.length) {
      try {
        const result = await wx.cloud.deleteFile({ fileList });
        success = (result.fileList || []).every((item) => item.status === 0);
      } catch (error) {
        console.warn("delete cloud photo files failed", error);
        success = false;
      }
    }
    try {
      await cloudStore.deletePhotoMeta(photo.id);
    } catch (error) {
      console.warn("delete cloud photo meta failed", error);
      success = false;
    }
    return success;
  },

  async deleteSelectedPhotos() {
    const ids = this.data.selectedPhotoIds;
    if (!ids.length || this.data.deleting) {
      return;
    }
    const photos = storage.getPhotos().filter((photo) => ids.includes(photo.id));
    const hasCloudFiles = photos.some((photo) => {
      return [photo.displayFileId, photo.originalFileId].some((fileID) => fileID && fileID.startsWith("cloud://"));
    });
    const confirmed = await this.confirmDelete(hasCloudFiles, photos.length);
    if (!confirmed) {
      return;
    }

    this.setData({ deleting: true });
    let cloudDeleted = true;
    for (const photo of photos) {
      const deleted = await this.deleteCloudPhoto(photo);
      cloudDeleted = cloudDeleted && deleted;
      await Promise.all([
        this.removeSavedFile(photo.compressedPath),
        photo.path !== photo.compressedPath ? this.removeSavedFile(photo.path) : Promise.resolve()
      ]);
      storage.removePhoto(photo.id);
    }
    this.setData({
      deleting: false,
      managing: false,
      selectedPhotoIds: []
    }, () => this.refreshGroups());
    wx.showToast({
      title: cloudDeleted ? `已删除${photos.length}张` : "本地已删，云端待清理",
      icon: cloudDeleted ? "success" : "none"
    });
  },

  goUpload() {
    wx.switchTab({ url: "/pages/upload/upload" });
  }
});
