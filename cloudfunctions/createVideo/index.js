const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event) => {
  const action = event.action || "create";

  if (action === "query") {
    // Replace with the video provider's task query API.
    // A completed task should return:
    // { status: "completed", statusText: "已完成", videoFileId, coverFileId }
    // or { status: "completed", statusText: "已完成", videoUrl, coverUrl }.
    return {
      taskId: event.taskId,
      status: "queued",
      statusText: "排队中"
    };
  }

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

  // Replace this block with the video provider's create-task API.
  // When generation is synchronous, return videoFileId/videoUrl directly.
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
