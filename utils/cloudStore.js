const DEFAULT_BABY_ID = "default-baby";
const PHOTO_COLLECTION = "photos";
const auth = require("./auth");

function hasCloud() {
  return Boolean(auth.canUseCloud() && auth.isLoggedIn());
}

function getMonthKey(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getExt(filePath) {
  const match = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(filePath);
  return match ? match[1].toLowerCase() : "jpg";
}

function getStorageSettings() {
  const saved = wx.getStorageSync("storage_settings") || {};
  return {
    mode: saved.mode || "saving",
    uploadOriginal: Boolean(saved.uploadOriginal),
    wifiOnlyOriginal: saved.wifiOnlyOriginal !== false,
    babyId: saved.babyId || DEFAULT_BABY_ID
  };
}

function saveStorageSettings(settings) {
  const current = getStorageSettings();
  const next = {
    ...current,
    ...settings
  };
  wx.setStorageSync("storage_settings", next);
  return next;
}

function getNetworkType() {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (res) => resolve(res.networkType),
      fail: () => resolve("unknown")
    });
  });
}

function uploadFile(cloudPath, filePath) {
  if (!hasCloud()) {
    return Promise.resolve({ fileID: "", cloudPath: "" });
  }

  return wx.cloud.uploadFile({
    cloudPath,
    filePath
  }).then((res) => ({
    fileID: res.fileID,
    cloudPath
  }));
}

async function uploadPhotoAssets(photo, localPaths, settings) {
  const session = auth.getSession();
  if (!session.loggedIn) {
    return {
      localOnly: true,
      displayFileId: "",
      originalFileId: ""
    };
  }
  const currentSettings = settings || getStorageSettings();
  const month = getMonthKey(photo.takenAt || photo.createdAt);
  const userId = session.user.id;
  const babyId = session.user.babyId || currentSettings.babyId;
  const basePath = `users/${userId}/babies/${babyId}/photos/${month}`;
  const displayExt = getExt(localPaths.displayPath);
  const originalExt = getExt(localPaths.originalPath);
  const networkType = await getNetworkType();
  const canUploadOriginal = currentSettings.uploadOriginal && (!currentSettings.wifiOnlyOriginal || networkType === "wifi");

  const display = await uploadFile(`${basePath}/display/${photo.id}.${displayExt}`, localPaths.displayPath);
  let original = { fileID: "", cloudPath: "" };

  if (canUploadOriginal) {
    original = await uploadFile(`${basePath}/original/${photo.id}.${originalExt}`, localPaths.originalPath);
  }

  return {
    displayFileId: display.fileID,
    displayCloudPath: display.cloudPath,
    originalFileId: original.fileID,
    originalCloudPath: original.cloudPath,
    originalUploadSkipped: currentSettings.uploadOriginal && !canUploadOriginal,
    networkType
  };
}

function savePhotoMeta(photo) {
  if (!hasCloud()) {
    return Promise.resolve({ localOnly: true });
  }

  const session = auth.getSession();
  const db = wx.cloud.database();
  const data = {
    ...photo,
    ownerId: session.user.id,
    babyId: session.user.babyId || DEFAULT_BABY_ID,
    updatedAt: db.serverDate()
  };
  return db.collection(PHOTO_COLLECTION).where({
    ownerId: session.user.id,
    id: photo.id
  }).get().then((res) => {
    if (res.data && res.data.length) {
      return db.collection(PHOTO_COLLECTION).doc(res.data[0]._id).update({ data });
    }
    return db.collection(PHOTO_COLLECTION).add({
      data: {
        ...data,
        createdAt: photo.createdAt || db.serverDate()
      }
    });
  });
}

async function pullCloudPhotos() {
  if (!hasCloud()) {
    return [];
  }
  const session = auth.getSession();
  const collection = wx.cloud.database().collection(PHOTO_COLLECTION);
  const pageSize = 20;
  const photos = [];
  let page = 0;
  let batch = [];

  do {
    const res = await collection.where({
      ownerId: session.user.id
    }).skip(page * pageSize).limit(pageSize).get();
    batch = res.data || [];
    photos.push(...batch);
    page += 1;
  } while (batch.length === pageSize);

  return photos.map((photo) => {
    const clean = { ...photo };
    delete clean._id;
    delete clean._openid;
    return {
      ...clean,
      compressedPath: clean.displayFileId || clean.compressedPath || "",
      path: clean.originalFileId || clean.path || "",
      cloudSynced: true
    };
  });
}

module.exports = {
  hasCloud,
  getStorageSettings,
  saveStorageSettings,
  uploadPhotoAssets,
  savePhotoMeta,
  pullCloudPhotos
};
