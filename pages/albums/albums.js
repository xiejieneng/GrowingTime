const storage = require("../../utils/storage");
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
    groups: []
  },

  onShow() {
    const photos = storage.getPhotos();
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

  goUpload() {
    wx.switchTab({ url: "/pages/upload/upload" });
  }
});
