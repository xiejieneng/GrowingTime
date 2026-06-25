const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const https = require("https");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

function base64url(value) {
  return Buffer.from(value).toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createToken(accessKey, secretKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5
  }));
  const content = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secretKey).update(content).digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${content}.${signature}`;
}

function requestJson(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (error) {
          reject(new Error(`AI_RESPONSE_INVALID:${text.slice(0, 120)}`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(data.message || `AI_HTTP_${res.statusCode}`));
          return;
        }
        if (typeof data.code !== "undefined" && Number(data.code) !== 0) {
          reject(new Error(data.message || `AI_CODE_${data.code}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function downloadBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        resolve(downloadBuffer(res.headers.location, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`VIDEO_DOWNLOAD_${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function statusResult(task) {
  const status = task.task_status || task.status || "submitted";
  if (status === "succeed" || status === "completed") {
    return { status: "completed", statusText: "AI 视频已完成" };
  }
  if (status === "failed") {
    return {
      status: "failed",
      statusText: "AI 生成失败",
      message: task.task_status_msg || task.message || ""
    };
  }
  if (status === "processing") {
    return { status: "in_progress", statusText: "AI 生成中" };
  }
  return { status: "queued", statusText: "AI 生成排队中" };
}

exports.main = async (event) => {
  const action = event.action || "create";
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) {
    return {
      error: "CONFIG_REQUIRED",
      message: "CONFIG_REQUIRED: 请配置可灵 AI 的 KLING_ACCESS_KEY 和 KLING_SECRET_KEY"
    };
  }
  const token = createToken(accessKey, secretKey);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  if (action === "query") {
    const response = await requestJson(
      `https://api.klingai.com/v1/videos/image2video/${encodeURIComponent(event.taskId)}`,
      { method: "GET", headers }
    );
    const task = response.data || response;
    const result = statusResult(task);
    const video = task.task_result && task.task_result.videos && task.task_result.videos[0];
    if (result.status !== "completed" || !video || !video.url) {
      return { taskId: event.taskId, ...result };
    }

    const wxContext = cloud.getWXContext();
    const cloudPath = `ai-videos/${wxContext.OPENID}/${event.taskId}.mp4`;
    try {
      const fileContent = await downloadBuffer(video.url);
      const uploaded = await cloud.uploadFile({ cloudPath, fileContent });
      return {
        taskId: event.taskId,
        ...result,
        videoFileId: uploaded.fileID
      };
    } catch (error) {
      console.warn("save generated video to cloud failed", error);
      return {
        taskId: event.taskId,
        ...result,
        videoUrl: video.url
      };
    }
  }

  const theme = event.theme || "宝宝成长回忆";
  const style = event.style || "温暖纪实";
  const duration = event.duration || 10;
  const photos = Array.isArray(event.photos) ? event.photos.slice(0, 1) : [];

  if (!photos.length) {
    return {
      error: "NO_PHOTOS",
      message: "至少需要选择一张照片"
    };
  }

  const photo = photos[0];
  let imageUrl = photo.fileID || photo.path || "";
  if (imageUrl.startsWith("cloud://")) {
    const temp = await cloud.getTempFileURL({ fileList: [imageUrl] });
    imageUrl = temp.fileList && temp.fileList[0] && temp.fileList[0].tempFileURL;
  }
  if (!imageUrl || !/^https:\/\//.test(imageUrl)) {
    return {
      error: "PHOTO_URL_REQUIRED",
      message: "照片尚未上传云端，请稍后重试"
    };
  }

  const stylePrompts = {
    "温暖纪实": "自然纪实风格，温暖柔和光线，动作真实细腻，镜头缓慢推进",
    "童话绘本": "温柔童话氛围，梦幻光影，轻盈自然的动作，保持人物外貌一致",
    "清新胶片": "清新胶片质感，自然日光，轻微手持镜头感，生活化动作",
    "生日派对": "欢乐生日氛围，彩色气球和柔和灯光，人物自然微笑并轻轻挥手"
  };
  const prompt = `${theme}。${stylePrompts[style] || style}。保持照片中人物身份、面部和服装一致，不改变年龄，不添加其他人物。`;
  const response = await requestJson(
    "https://api.klingai.com/v1/videos/image2video",
    { method: "POST", headers },
    {
      model_name: process.env.KLING_VIDEO_MODEL || "kling-v1-6",
      mode: "std",
      duration: String(duration === 5 ? 5 : 10),
      image: imageUrl,
      prompt,
      cfg_scale: 0.5
    }
  );
  const task = response.data || response;
  const taskId = task.task_id || task.id;
  if (!taskId) {
    return {
      error: "AI_TASK_CREATE_FAILED",
      message: response.message || "AI 服务未返回任务编号"
    };
  }
  return {
    taskId,
    ...statusResult(task),
    theme,
    style,
    duration,
    photoCount: 1
  };
};
