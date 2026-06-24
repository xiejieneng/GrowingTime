const { parseExifDate } = require("./date");

const TAGS = {
  0x0132: "modifiedAt",
  0x9003: "takenAt",
  0x9004: "digitizedAt",
  0x8825: "gpsInfo"
};

const GPS_TAGS = {
  0x0001: "latRef",
  0x0002: "lat",
  0x0003: "lngRef",
  0x0004: "lng"
};

function getString(view, offset, length) {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(offset + i);
    if (code === 0) {
      break;
    }
    value += String.fromCharCode(code);
  }
  return value;
}

function readValue(view, tiffStart, entryOffset, littleEndian) {
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  const valueOffset = entryOffset + 8;
  const raw = view.getUint32(valueOffset, littleEndian);
  const dataOffset = count > 4 ? tiffStart + raw : valueOffset;

  if (type === 2) {
    return getString(view, dataOffset, count);
  }

  if (type === 5) {
    const values = [];
    for (let i = 0; i < count; i += 1) {
      const offset = dataOffset + i * 8;
      const numerator = view.getUint32(offset, littleEndian);
      const denominator = view.getUint32(offset + 4, littleEndian) || 1;
      values.push(numerator / denominator);
    }
    return values;
  }

  if (type === 3) {
    return count === 1 ? view.getUint16(valueOffset, littleEndian) : raw;
  }

  if (type === 4) {
    return raw;
  }

  return null;
}

function parseDirectory(view, tiffStart, directoryOffset, littleEndian, tagMap) {
  if (!directoryOffset || tiffStart + directoryOffset >= view.byteLength) {
    return {};
  }

  const result = {};
  const dirStart = tiffStart + directoryOffset;
  const entries = view.getUint16(dirStart, littleEndian);

  for (let i = 0; i < entries; i += 1) {
    const entryOffset = dirStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) {
      break;
    }
    const tag = view.getUint16(entryOffset, littleEndian);
    const name = tagMap[tag];
    if (name) {
      result[name] = readValue(view, tiffStart, entryOffset, littleEndian);
    }
  }

  return result;
}

function toCoordinate(values, ref) {
  if (!Array.isArray(values) || values.length < 3) {
    return null;
  }
  const coordinate = values[0] + values[1] / 60 + values[2] / 3600;
  return ref === "S" || ref === "W" ? -coordinate : coordinate;
}

function parseExif(buffer) {
  const view = new DataView(buffer);
  if (view.getUint16(0) !== 0xffd8) {
    return {};
  }

  let offset = 2;
  while (offset < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      break;
    }

    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1 && getString(view, offset + 4, 4) === "Exif") {
      const tiffStart = offset + 10;
      const byteOrder = getString(view, tiffStart, 2);
      const littleEndian = byteOrder === "II";
      const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
      const ifd = parseDirectory(view, tiffStart, firstIfdOffset, littleEndian, TAGS);
      const gps = parseDirectory(view, tiffStart, ifd.gpsInfo, littleEndian, GPS_TAGS);
      const takenDate = parseExifDate(ifd.takenAt || ifd.digitizedAt || ifd.modifiedAt);
      const latitude = toCoordinate(gps.lat, gps.latRef);
      const longitude = toCoordinate(gps.lng, gps.lngRef);

      return {
        takenAt: takenDate ? takenDate.toISOString() : "",
        latitude,
        longitude,
        hasGps: typeof latitude === "number" && typeof longitude === "number"
      };
    }

    offset += 2 + size;
  }

  return {};
}

function readExif(filePath) {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath,
      success: (res) => {
        try {
          resolve(parseExif(res.data));
        } catch (error) {
          console.warn("parse exif failed", error);
          resolve({});
        }
      },
      fail: () => resolve({})
    });
  });
}

module.exports = {
  readExif,
  parseExif
};
