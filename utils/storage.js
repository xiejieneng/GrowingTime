const PHOTO_KEY = "growth_photos";
const VIDEO_KEY = "growth_videos";

function readList(key) {
  try {
    return wx.getStorageSync(key) || [];
  } catch (error) {
    console.warn("read storage failed", key, error);
    return [];
  }
}

function writeList(key, value) {
  wx.setStorageSync(key, value);
}

function getPhotos() {
  return readList(PHOTO_KEY);
}

function savePhotos(photos) {
  writeList(PHOTO_KEY, photos);
}

function addPhotos(photos) {
  const current = getPhotos();
  savePhotos(photos.concat(current));
}

function mergePhotos(photos) {
  const merged = new Map();
  getPhotos().concat(photos || []).forEach((photo) => {
    const current = merged.get(photo.id) || {};
    merged.set(photo.id, {
      ...current,
      ...photo,
      compressedPath: photo.compressedPath || current.compressedPath || photo.displayFileId || "",
      path: photo.path || current.path || ""
    });
  });
  const result = Array.from(merged.values()).sort((a, b) => {
    return new Date(b.takenAt || b.createdAt || 0) - new Date(a.takenAt || a.createdAt || 0);
  });
  savePhotos(result);
  return result;
}

function updatePhoto(id, patch) {
  const photos = getPhotos().map((photo) => photo.id === id ? { ...photo, ...patch } : photo);
  savePhotos(photos);
  return photos.find((photo) => photo.id === id);
}

function getStorageStats() {
  const photos = getPhotos();
  const videos = getVideos();
  const displayBytes = photos.reduce((sum, item) => sum + (item.compressedSize || item.displaySize || 0), 0);
  const originalBytes = photos.reduce((sum, item) => sum + (item.originalSize || 0), 0);
  const cloudPhotos = photos.filter((item) => item.displayFileId || item.originalFileId).length;

  return {
    photoCount: photos.length,
    videoCount: videos.length,
    displayBytes,
    originalBytes,
    savedBytes: Math.max(originalBytes - displayBytes, 0),
    cloudPhotos
  };
}

function getVideos() {
  return readList(VIDEO_KEY);
}

function saveVideos(videos) {
  writeList(VIDEO_KEY, videos);
}

function addVideo(video) {
  const current = getVideos();
  saveVideos([video].concat(current));
}

module.exports = {
  getPhotos,
  savePhotos,
  addPhotos,
  mergePhotos,
  updatePhoto,
  getStorageStats,
  getVideos,
  saveVideos,
  addVideo
};
