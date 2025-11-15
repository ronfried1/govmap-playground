export type DbfFieldMeta = {
  name: string;
  type: string;
  length: number;
  decimalCount: number;
};

export type DbfCsvResult = {
  csv: string;
  recordCount: number;
  parsedRecords: number;
  headerLength: number;
  recordLength: number;
  fields: DbfFieldMeta[];
};

const asciiDecoder = new TextDecoder("ascii");

function sanitizeText(bytes: Uint8Array) {
  const decoded = asciiDecoder.decode(bytes);
  return decoded.replace(/\u0000/g, "").trim();
}

function escapeCsv(value: string) {
  const needsWrapper =
    value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r");
  const escaped = value.replace(/"/g, '""');
  return needsWrapper ? `"${escaped}"` : escaped;
}

export function convertDbfToCsv(buffer: ArrayBuffer): DbfCsvResult {
  const view = new DataView(buffer);
  if (view.byteLength < 32) {
    throw new Error("Buffer is too small to be a valid DBF file.");
  }

  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);

  if (headerLength === 0 || recordLength === 0) {
    throw new Error("Malformed DBF header.");
  }

  if (headerLength > buffer.byteLength) {
    throw new Error("Header length is larger than the file itself.");
  }

  const fields: DbfFieldMeta[] = [];
  let descriptorOffset = 32;

  while (descriptorOffset < headerLength) {
    const marker = view.getUint8(descriptorOffset);
    if (marker === 0x0d) {
      descriptorOffset += 1;
      break;
    }

    const nameBytes = new Uint8Array(buffer, descriptorOffset, 11);
    const name = sanitizeText(nameBytes) || `FIELD_${fields.length + 1}`;
    const type = String.fromCharCode(view.getUint8(descriptorOffset + 11));
    const length = view.getUint8(descriptorOffset + 16);
    const decimalCount = view.getUint8(descriptorOffset + 17);

    fields.push({ name, type, length, decimalCount });
    descriptorOffset += 32;
  }

  if (!fields.length) {
    throw new Error("DBF file does not define any fields.");
  }

  const rows: string[] = [];
  rows.push(fields.map((field) => escapeCsv(field.name)).join(","));

  const dataStart = headerLength;
  if (dataStart + recordLength > buffer.byteLength) {
    throw new Error("DBF payload is truncated.");
  }

  let parsedRecords = 0;

  for (let rowIndex = 0; rowIndex < recordCount; rowIndex += 1) {
    const recordOffset = dataStart + rowIndex * recordLength;
    if (recordOffset + recordLength > buffer.byteLength) {
      break;
    }

    const deletionFlag = view.getUint8(recordOffset);
    if (deletionFlag === 0x2a) {
      continue;
    }

    let fieldOffset = recordOffset + 1;
    const csvCells: string[] = [];

    for (const field of fields) {
      if (fieldOffset + field.length > buffer.byteLength) {
        throw new Error("Encountered a record extending beyond the file size.");
      }
      const slice = new Uint8Array(buffer, fieldOffset, field.length);
      const value = sanitizeText(slice);
      csvCells.push(escapeCsv(value));
      fieldOffset += field.length;
    }

    rows.push(csvCells.join(","));
    parsedRecords += 1;
  }

  return {
    csv: rows.join("\r\n"),
    recordCount,
    parsedRecords,
    headerLength,
    recordLength,
    fields,
  };
}
