const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event) => {
  const theme = event.theme || "宝宝成长回忆";
  const style = event.style || "温暖纪实";
  const duration = event.duration || 15;
  const photos = Array.isArray(event.photos) ? event.photos : [];

  if (!photos.length) {
    return {
      error: "NO_PHOTOS",
      message: "至少需要选择一张照片"
    };
  }

  // Replace this block with your video model provider call.
  // Suggested payload: { theme, style, duration, photos }.
  return {
    taskId: `mock_${Date.now()}`,
    status: "queued",
    statusText: "排队中",
    theme,
    style,
    duration,
    photoCount: photos.length
  };
};
