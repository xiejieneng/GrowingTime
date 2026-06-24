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
  const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = {
  formatDate,
  monthKey,
  parseExifDate
};
