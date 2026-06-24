const storage = require("../../utils/storage");
const cloudStore = require("../../utils/cloudStore");
const auth = require("../../utils/auth");
const { formatDate, monthKey } = require("../../utils/date");

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
    deletingPhotoId: ""
  },

  onShow() {
    this.refreshGroups();
  },

  refreshGroups(photos = storage.getPhotos()) {
    const grouped = photos.reduce((acc, photo) => {
      const month = monthKey(photo.takenAt || photo.createdAt);
      if (!acc[month]) {
        acc[month] = [];
      }
      acc[month].push({
        ...photo,
        displayDate: formatDate(photo.takenAt || photo.createdAt) || "未知日期",
        placeText: placeText(photo)
      });
      return acc;
    }, {});

    const groups = Object.keys(grouped).map((month) => ({
      month,
      photos: grouped[month]
    }));

    this.setData({ groups });
  },

  previewPhoto(event) {
    const current = event.currentTarget.dataset.src;
    const urls = this.data.groups.flatMap((group) => group.photos.map((photo) => photo.compressedPath || photo.path));
    wx.previewImage({
      current,
      urls
    });
  },

  confirmDelete(hasCloudFiles) {
    return new Promise((resolve) => {
      wx.showModal({
        title: "删除照片",
        content: hasCloudFiles
          ? "将删除本地照片记录，并清理云端展示图、原图和照片索引。此操作不可恢复。"
          : "将删除这张照片及本地整理记录。此操作不可恢复。",
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

  async deletePhoto(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.deletingPhotoId) {
      return;
    }
    const photo = storage.getPhotos().find((item) => item.id === id);
    if (!photo) {
      return;
    }
    const hasCloudFiles = [photo.displayFileId, photo.originalFileId].some((fileID) => {
      return fileID && fileID.startsWith("cloud://");
    });
    const confirmed = await this.confirmDelete(hasCloudFiles);
    if (!confirmed) {
      return;
    }

    this.setData({ deletingPhotoId: id });
    const cloudDeleted = await this.deleteCloudPhoto(photo);
    await Promise.all([
      this.removeSavedFile(photo.compressedPath),
      photo.path !== photo.compressedPath ? this.removeSavedFile(photo.path) : Promise.resolve()
    ]);
    const photos = storage.removePhoto(id);
    this.refreshGroups(photos);
    this.setData({ deletingPhotoId: "" });
    wx.showToast({
      title: cloudDeleted ? "照片已删除" : "本地已删，云端待清理",
      icon: cloudDeleted ? "success" : "none"
    });
  },

  goUpload() {
    wx.switchTab({ url: "/pages/upload/upload" });
  }
});
