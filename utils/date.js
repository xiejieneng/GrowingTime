function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return "未知时间";
  }
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月`;
}

function parseExifDate(value) {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  const date = match
    ? new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    )
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function photoTakenAt(photo) {
  if (!photo || !photo.takenAt || photo.dateSource === "unknown") {
    return "";
  }
  if (photo.dateSource === "exif") {
    return photo.takenAt;
  }
  if (photo.createdAt) {
    const taken = new Date(photo.takenAt).getTime();
    const uploaded = new Date(photo.createdAt).getTime();
    if (!Number.isNaN(taken) && !Number.isNaN(uploaded) && Math.abs(taken - uploaded) < 5 * 60 * 1000) {
      return "";
    }
  }
  return photo.takenAt;
}

module.exports = {
  formatDate,
  monthKey,
  parseExifDate,
  photoTakenAt
};
