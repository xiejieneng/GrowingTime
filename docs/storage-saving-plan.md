# 婴儿成长相册省钱存储方案

## 目标

在照片和视频持续增长的情况下，控制云存储、CDN 流量、数据库查询和 AI 视频生成素材传输成本，同时保证用户能快速浏览相册、按需恢复高清素材。

## 默认策略

1. 本地临时处理
   - 小程序本地读取 EXIF、生成展示图、预览处理结果。
   - 本地文件只作为近期缓存，不作为长期存储。

2. 展示图热存储
   - 默认上传压缩后的展示图。
   - 相册列表、时间线、视频素材预选优先使用展示图。
   - 默认最长边 4096px、质量 92%；后续可按会员等级降到 3072px 或升到原图备份。

3. 原图按需备份
   - 默认不上传原图，降低 60% 到 80% 左右存储成本。
   - 用户开启“高清备份”后，仅 Wi-Fi 下上传原图。
   - 非 Wi-Fi 时记录 `originalUploadSkipped`，后续可做后台补传或提醒用户在 Wi-Fi 下同步。

4. 数据库只存索引
   - 云数据库存照片元数据、云文件 ID、拍摄时间、GPS、月份索引、大小信息。
   - 不把图片二进制写入数据库。

5. AI 视频复用素材
   - 视频生成优先使用已上传的 `originalFileId`，没有原图时使用 `displayFileId`。
   - 避免每次生成视频重复上传同一批照片。
   - 成品视频与封面单独存储，数据库只存任务状态和结果 fileID。

## 云存储目录

```text
users/{userId}/babies/{babyId}/photos/{yyyy-mm}/display/{photoId}.jpg
users/{userId}/babies/{babyId}/photos/{yyyy-mm}/original/{photoId}.jpg
users/{userId}/babies/{babyId}/videos/{videoId}.mp4
users/{userId}/babies/{babyId}/videos/{videoId}_cover.jpg
```

当前实现由账户云函数根据微信身份生成内部 `userId`，客户端不保存或暴露 OPENID。游客状态不会创建云文件，注册登录后才允许上传。

## 照片元数据

```js
{
  id,
  babyId,
  takenAt,
  createdAt,
  latitude,
  longitude,
  hasGps,
  width,
  height,
  originalSize,
  displaySize,
  displayFileId,
  originalFileId,
  displayCloudPath,
  originalCloudPath,
  storageMode,
  cloudSynced,
  originalUploadSkipped,
  networkType
}
```

## 已开发到小程序内

- `utils/cloudStore.js`
  - 游客/登录状态分流
  - 存储模式配置
  - Wi-Fi 判断
  - 展示图/原图分层上传
  - 照片元数据写入 `photos` 集合

- `pages/upload/upload`
  - 增加“省钱模式/高清备份”开关
  - 默认只上传展示图和索引
  - 开启高清备份后，仅 Wi-Fi 下上传原图
  - 云上传失败时仍保留本地整理结果

- `pages/index/index`
  - 增加省钱存储概览
  - 展示展示图容量、原图估算容量、已节省容量、云同步照片数

- `pages/video/video`
  - AI 视频生成优先复用照片已有 `fileID`
  - 没有 fileID 时才临时上传素材

- `pages/account/account`
  - 微信身份首次使用自动注册、再次使用直接登录
  - 登录后分页恢复云端照片
  - 将游客阶段的本地历史照片手动同步到云端

## 后续建议

- 用云函数封装照片上传签名和元数据写入，客户端只传必要信息。
- 增加后台 Wi-Fi 补传队列。
- 增加会员容量表，例如免费 2GB、家庭版 50GB、长期归档版 200GB。
- 对一年以上未访问原图转低频存储，展示图继续热存储。
