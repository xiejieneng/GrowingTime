function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject
    });
  });
}

function canvasToTempFilePath(options, context) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      ...options,
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    }, context);
  });
}

function getFileInfo(filePath) {
  return new Promise((resolve) => {
    wx.getFileInfo({
      filePath,
      success: resolve,
      fail: () => resolve({ size: 0 })
    });
  });
}

function saveTempFile(tempFilePath) {
  return new Promise((resolve) => {
    wx.saveFile({
      tempFilePath,
      success: (res) => resolve(res.savedFilePath),
      fail: () => resolve(tempFilePath)
    });
  });
}

function removeSavedFile(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !filePath.startsWith("wxfile://")) {
      resolve();
      return;
    }
    wx.removeSavedFile({
      filePath,
      complete: resolve
    });
  });
}

function calcTargetSize(width, height, maxSide) {
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) {
    return { width, height };
  }
  const ratio = maxSide / longSide;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio)
  };
}

function updateCanvasSize(page, width, height) {
  return new Promise((resolve) => {
    page.setData({
      canvasWidth: width,
      canvasHeight: height
    }, () => {
      if (wx.nextTick) {
        wx.nextTick(resolve);
      } else {
        setTimeout(resolve, 16);
      }
    });
  });
}

async function compressPhoto(page, filePath, options = {}) {
  const qualityPercent = Math.min(Math.max(Number(options.quality) || 92, 70), 100);
  const quality = qualityPercent / 100;
  const maxSide = options.maxSide || 4096;
  const info = await getImageInfo(filePath);
  const target = calcTargetSize(info.width, info.height, maxSide);

  await updateCanvasSize(page, target.width, target.height);

  const ctx = wx.createCanvasContext("compressCanvas", page);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(filePath, 0, 0, target.width, target.height);

  await new Promise((resolve) => ctx.draw(false, resolve));
  const outputPath = await canvasToTempFilePath({
    canvasId: "compressCanvas",
    x: 0,
    y: 0,
    width: target.width,
    height: target.height,
    destWidth: target.width,
    destHeight: target.height,
    fileType: "jpg",
    quality
  }, page);
  const savedPath = await saveTempFile(outputPath);

  const originalInfo = await getFileInfo(filePath);
  const compressedInfo = await getFileInfo(savedPath);
  const compressedIsSmaller = compressedInfo.size > 0
    && (!originalInfo.size || compressedInfo.size < originalInfo.size);

  if (!compressedIsSmaller && originalInfo.size) {
    await removeSavedFile(savedPath);
    const originalPath = await saveTempFile(filePath);
    return {
      path: originalPath,
      width: info.width,
      height: info.height,
      originalSize: originalInfo.size,
      compressedSize: originalInfo.size,
      quality: 100,
      ratio: 0,
      reusedOriginal: true
    };
  }

  return {
    path: savedPath,
    width: target.width,
    height: target.height,
    originalSize: originalInfo.size,
    compressedSize: compressedInfo.size,
    quality: qualityPercent,
    ratio: originalInfo.size ? Math.round((1 - compressedInfo.size / originalInfo.size) * 100) : 0,
    reusedOriginal: false
  };
}

module.exports = {
  compressPhoto,
  getFileInfo,
  saveTempFile
};
