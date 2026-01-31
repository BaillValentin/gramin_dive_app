/**
 * FIT file parser — lightweight custom parser for dive FIT files.
 * Parses the binary FIT format directly (no SDK dependency needed in browser).
 */

const FIT_TYPES = {
  0: 'enum', 1: 'sint8', 2: 'uint8', 3: 'sint16', 4: 'uint16',
  5: 'sint32', 6: 'uint32', 7: 'string', 10: 'uint8z', 11: 'uint16z',
  12: 'uint32z', 13: 'uint8', 131: 'uint16', 132: 'uint32', 133: 'sint8',
  134: 'sint16', 135: 'sint32', 136: 'uint8z', 137: 'uint16z', 138: 'uint32z',
  139: 'float32', 140: 'float64'
};

// Global message numbers we care about
const MESG_NUM = {
  SESSION: 18,
  LAP: 19,
  RECORD: 20,
  EVENT: 21,
  DEVICE_INFO: 23,
  DIVE_SUMMARY: 268,
  DIVE_GAS: 259,
  DIVE_SETTINGS: 258,
  DIVE_ALARM: 262,
};

// Field definitions for record messages (subset relevant to diving)
const RECORD_FIELDS = {
  253: 'timestamp',
  0: 'position_lat',
  1: 'position_long',
  2: 'altitude',
  5: 'distance',
  6: 'speed',
  22: 'depth',        // in meters (scaled)
  24: 'ascent_rate',  // m/s
  73: 'temperature',  // °C
  91: 'po2',
  92: 'ndl',
  93: 'cns',
};

const GARMIN_EPOCH = new Date('1989-12-31T00:00:00Z').getTime() / 1000;

export function parseFIT(buffer) {
  const data = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // --- Header ---
  const headerSize = bytes[0];
  const protocolVersion = bytes[1];
  const profileVersion = data.getUint16(2, true);
  const dataSize = data.getUint32(4, true);
  const dataType = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);

  if (dataType !== '.FIT') {
    throw new Error('Not a valid FIT file');
  }

  offset = headerSize;
  const endOfData = headerSize + dataSize;

  const definitions = {};
  const messages = [];

  while (offset < endOfData) {
    const recordHeader = bytes[offset++];

    // Compressed timestamp header
    if (recordHeader & 0x80) {
      const localMesgType = (recordHeader >> 5) & 0x3;
      const timeOffset = recordHeader & 0x1F;
      const def = definitions[localMesgType];
      if (def) {
        const msg = readDataMessage(def);
        if (msg) messages.push(msg);
      }
      continue;
    }

    const isDefinition = (recordHeader & 0x40) !== 0;
    const localMesgType = recordHeader & 0x0F;
    const hasDeveloperData = (recordHeader & 0x20) !== 0;

    if (isDefinition) {
      // Definition message
      offset++; // reserved
      const arch = bytes[offset++]; // 0=little, 1=big
      const littleEndian = arch === 0;
      const globalMesgNum = littleEndian
        ? data.getUint16(offset, true)
        : data.getUint16(offset, false);
      offset += 2;
      const numFields = bytes[offset++];

      const fields = [];
      for (let i = 0; i < numFields; i++) {
        const fieldDefNum = bytes[offset++];
        const size = bytes[offset++];
        const baseType = bytes[offset++];
        fields.push({ fieldDefNum, size, baseType });
      }

      let devFields = [];
      if (hasDeveloperData) {
        const numDevFields = bytes[offset++];
        for (let i = 0; i < numDevFields; i++) {
          const fNum = bytes[offset++];
          const sz = bytes[offset++];
          const devIdx = bytes[offset++];
          devFields.push({ fNum, size: sz, devIdx });
        }
      }

      definitions[localMesgType] = { globalMesgNum, fields, devFields, littleEndian };
    } else {
      // Data message
      const def = definitions[localMesgType];
      if (!def) {
        // Skip unknown — shouldn't happen in valid FIT
        break;
      }
      const msg = readDataMessage(def);
      if (msg) messages.push(msg);
    }
  }

  function readDataMessage(def) {
    const result = { _mesgNum: def.globalMesgNum };
    const le = def.littleEndian;

    for (const field of def.fields) {
      const val = readFieldValue(field, le);
      result[field.fieldDefNum] = val;
    }

    // Skip developer fields
    for (const df of (def.devFields || [])) {
      offset += df.size;
    }

    return result;
  }

  function readFieldValue(field, le) {
    const start = offset;
    const { size, baseType } = field;
    let val;

    const bt = baseType & 0x1F; // base type number

    switch (bt) {
      case 0: // enum / uint8
      case 2: // uint8
      case 10: // uint8z
      case 13:
        val = bytes[offset];
        if (val === 0xFF) val = null;
        break;
      case 1: // sint8
        val = data.getInt8(offset);
        if (val === 0x7F) val = null;
        break;
      case 3: // sint16
        val = data.getInt16(offset, le);
        if (val === 0x7FFF) val = null;
        break;
      case 4: // uint16
      case 11: // uint16z
        val = data.getUint16(offset, le);
        if (val === 0xFFFF) val = null;
        break;
      case 5: // sint32
        val = data.getInt32(offset, le);
        if (val === 0x7FFFFFFF) val = null;
        break;
      case 6: // uint32
      case 12: // uint32z
        val = data.getUint32(offset, le);
        if (val === 0xFFFFFFFF) val = null;
        break;
      case 7: // string
        val = '';
        for (let i = 0; i < size; i++) {
          const c = bytes[offset + i];
          if (c === 0) break;
          val += String.fromCharCode(c);
        }
        break;
      case 8: // float32
        val = data.getFloat32(offset, le);
        break;
      case 9: // float64
        val = data.getFloat64(offset, le);
        break;
      default:
        val = null;
    }

    offset = start + size;
    return val;
  }

  return messages;
}

export function garminTimestampToDate(ts) {
  if (!ts) return null;
  return new Date((ts + GARMIN_EPOCH) * 1000);
}
