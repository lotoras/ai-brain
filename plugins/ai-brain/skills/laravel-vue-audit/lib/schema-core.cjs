/**
 * Generic, dependency-free JSON-schema interpreter and safe-input helpers shared by
 * validate-findings.cjs and validate-coverage-ledger.cjs.
 *
 * Adapted from cloudflare/security-audit-skill (validate-findings.cjs), MIT License,
 * Copyright (c) 2025-2026 Cloudflare, Inc. See ../NOTICE.md for the full notice.
 * Changes: extracted into a module; added maxItems; portable lstat-based file reading
 * (O_NOFOLLOW is unavailable on Windows).
 */

const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const SUPPORTED_TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);
const SUPPORTED_KEYWORDS = new Set([
  "$comment",
  "additionalProperties",
  "const",
  "description",
  "enum",
  "items",
  "minimum",
  "minItems",
  "maxItems",
  "minLength",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "type",
  "uniqueItems",
  "visibleContent",
]);
const LIMITS = Object.freeze({
  inputBytes: 5 * 1024 * 1024,
  nestingDepth: 64,
  arrayItems: 1000,
  canonicalKeyBytes: 1024 * 1024,
  uniqueSetBytes: 5 * 1024 * 1024,
  validationErrors: 100,
});
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const PATH_FORBIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const UNSAFE_DIAGNOSTIC_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
const MAX_DIAGNOSTIC_STRING_LENGTH = 256;

class JsonStructureError extends Error {}
class SafeInputError extends Error {}

function escapeUnsafeDiagnosticCharacters(value) {
  return String(value).replace(UNSAFE_DIAGNOSTIC_CHARACTER, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0xffff
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : `\\u{${codePoint.toString(16)}}`;
  });
}

function safeQuote(value) {
  let serialized;
  if (typeof value === "string") {
    const clipped = value.length > MAX_DIAGNOSTIC_STRING_LENGTH
      ? `${value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...`
      : value;
    serialized = JSON.stringify(clipped);
  } else if (value === null || typeof value === "boolean") {
    serialized = String(value);
  } else if (typeof value === "number" && Number.isFinite(value)) {
    serialized = String(value);
  } else {
    serialized = `"<${Array.isArray(value) ? "array" : typeof value}>"`;
  }
  return escapeUnsafeDiagnosticCharacters(serialized);
}

function propertyPath(base, key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${safeQuote(key)}]`;
}

function createErrorList() {
  const errors = [];
  Object.defineProperty(errors, "push", {
    value(...messages) {
      const remaining = LIMITS.validationErrors - this.length;
      if (remaining > 0) {
        Array.prototype.push.apply(this, messages.slice(0, remaining).map(escapeUnsafeDiagnosticCharacters));
      }
      return this.length;
    },
  });
  return errors;
}

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (typeOf(left) !== typeOf(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (left !== null && typeof left === "object") {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

function codePointLength(value) {
  let length = 0;
  let index = 0;
  while (index < value.length) {
    const first = value.charCodeAt(index++);
    if (first >= 0xd800 && first <= 0xdbff && index < value.length) {
      const second = value.charCodeAt(index);
      if (second >= 0xdc00 && second <= 0xdfff) index++;
    }
    length++;
  }
  return length;
}

function hasValidUnicodeScalarValues(value) {
  let index = 0;
  while (index < value.length) {
    const first = value.charCodeAt(index++);
    if (first >= 0xd800 && first <= 0xdbff) {
      if (index >= value.length) return false;
      const second = value.charCodeAt(index++);
      if (second < 0xdc00 || second > 0xdfff) return false;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasVisibleProse(value) {
  return hasValidUnicodeScalarValues(value) && VISIBLE_CONTENT.test(value);
}

function canonicalKey(value) {
  const chunks = [];
  let bytes = 0;

  function append(chunk) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > LIMITS.canonicalKeyBytes) {
      throw new Error(`canonical key exceeds ${LIMITS.canonicalKeyBytes} byte limit`);
    }
    chunks.push(chunk);
  }

  function encode(item) {
    const type = typeOf(item);
    if (type === "null") {
      append("null");
    } else if (type === "string") {
      append(`string:${JSON.stringify(item)}`);
    } else if (type === "number") {
      append(`number:${Object.is(item, -0) ? "0" : String(item)}`);
    } else if (type === "boolean") {
      append(`boolean:${item ? "true" : "false"}`);
    } else if (type === "array") {
      append("array:[");
      item.forEach((entry, index) => {
        if (index > 0) append(",");
        encode(entry);
      });
      append("]");
    } else if (type === "object") {
      append("object:{");
      Object.keys(item).sort().forEach((key, index) => {
        if (index > 0) append(",");
        append(JSON.stringify(key));
        append(":");
        encode(item[key]);
      });
      append("}");
    } else {
      append(`${type}:${String(item)}`);
    }
  }

  encode(value);
  return { key: chunks.join(""), bytes };
}

function collectDataLimitErrors(value, location = "$data") {
  const stack = [{ value, location, depth: value !== null && typeof value === "object" ? 1 : 0 }];
  const seen = new WeakSet();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current.value === null || typeof current.value !== "object") continue;
    if (current.depth > LIMITS.nestingDepth) {
      return [escapeUnsafeDiagnosticCharacters(`${current.location}: exceeds ${LIMITS.nestingDepth} level nesting depth limit`)];
    }
    if (seen.has(current.value)) {
      return [escapeUnsafeDiagnosticCharacters(`${current.location}: input must not contain repeated or cyclic object references`)];
    }
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      if (current.value.length > LIMITS.arrayItems) {
        return [escapeUnsafeDiagnosticCharacters(`${current.location}: exceeds ${LIMITS.arrayItems} item array limit`)];
      }
      for (let index = current.value.length - 1; index >= 0; index--) {
        const child = current.value[index];
        if (child !== null && typeof child === "object") {
          stack.push({ value: child, location: `${current.location}[${index}]`, depth: current.depth + 1 });
        }
      }
    } else {
      const keys = Object.keys(current.value);
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index];
        const child = current.value[key];
        if (child !== null && typeof child === "object") {
          stack.push({ value: child, location: propertyPath(current.location, key), depth: current.depth + 1 });
        }
      }
    }
  }

  return [];
}

function collectSchemaErrors(schema, location = "schema") {
  const errors = createErrorList();

  function check(node, p) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      errors.push(`${p}: schema must be an object`);
      return;
    }

    for (const key of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(key)) errors.push(`${p}: unsupported schema keyword ${safeQuote(key)}`);
    }

    if (hasOwn(node, "$comment") && typeof node.$comment !== "string") {
      errors.push(`${p}.$comment: expected string`);
    }
    if (hasOwn(node, "description") && typeof node.description !== "string") {
      errors.push(`${p}.description: expected string`);
    }
    if (hasOwn(node, "type") && (!SUPPORTED_TYPES.has(node.type))) {
      errors.push(`${p}.type: unsupported type ${safeQuote(node.type)}`);
    }
    if (hasOwn(node, "properties")) {
      if (node.properties === null || typeof node.properties !== "object" || Array.isArray(node.properties)) {
        errors.push(`${p}.properties: expected object`);
      } else {
        for (const key of Object.keys(node.properties)) check(node.properties[key], propertyPath(`${p}.properties`, key));
      }
    }
    if (hasOwn(node, "required")) {
      if (!Array.isArray(node.required) || node.required.some((key) => typeof key !== "string")) {
        errors.push(`${p}.required: expected an array of strings`);
      } else if (new Set(node.required).size !== node.required.length) {
        errors.push(`${p}.required: entries must be unique`);
      }
    }
    if (hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") {
      errors.push(`${p}.additionalProperties: only boolean values are supported`);
    }
    if (hasOwn(node, "enum")) {
      if (!Array.isArray(node.enum) || node.enum.length === 0) {
        errors.push(`${p}.enum: expected a non-empty array`);
      } else {
        const seen = new Set();
        for (const value of node.enum) {
          let key;
          try {
            key = canonicalKey(value).key;
          } catch (error) {
            errors.push(`${p}.enum: ${error.message}`);
            break;
          }
          if (seen.has(key)) {
            errors.push(`${p}.enum: entries must be unique`);
            break;
          }
          seen.add(key);
        }
      }
    }
    if (hasOwn(node, "items")) check(node.items, `${p}.items`);
    for (const keyword of ["minItems", "maxItems", "minLength"]) {
      if (hasOwn(node, keyword) && (!Number.isInteger(node[keyword]) || node[keyword] < 0)) {
        errors.push(`${p}.${keyword}: expected a non-negative integer`);
      }
    }
    if (hasOwn(node, "minimum") && (typeof node.minimum !== "number" || !Number.isFinite(node.minimum))) {
      errors.push(`${p}.minimum: expected a finite number`);
    }
    if (hasOwn(node, "pattern")) {
      if (typeof node.pattern !== "string") {
        errors.push(`${p}.pattern: expected string`);
      } else {
        try {
          new RegExp(node.pattern);
        } catch (error) {
          errors.push(`${p}.pattern: invalid regular expression`);
        }
      }
    }
    if (hasOwn(node, "uniqueItems") && typeof node.uniqueItems !== "boolean") {
      errors.push(`${p}.uniqueItems: expected boolean`);
    }
    if (hasOwn(node, "visibleContent")) {
      if (typeof node.visibleContent !== "boolean") {
        errors.push(`${p}.visibleContent: expected boolean`);
      } else if (node.visibleContent === true && node.type !== "string") {
        errors.push(`${p}.visibleContent: requires type "string"`);
      }
    }
    if (hasOwn(node, "oneOf")) {
      if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) {
        errors.push(`${p}.oneOf: expected a non-empty array`);
      } else {
        node.oneOf.forEach((branch, index) => check(branch, `${p}.oneOf[${index}]`));
      }
    }
  }

  check(schema, location);
  return errors;
}

function findDiscriminator(schema) {
  if (!hasOwn(schema, "properties") || typeof schema.properties !== "object") return null;
  for (const key of Object.keys(schema.properties)) {
    const subSchema = schema.properties[key];
    if (subSchema && typeof subSchema === "object" && hasOwn(subSchema, "const")) {
      return { key, value: subSchema.const };
    }
  }
  return null;
}

function validate(value, schema, p, errors) {
  if (errors.length >= LIMITS.validationErrors) return;
  if (hasOwn(schema, "oneOf")) {
    const results = schema.oneOf.map((branch) => collectUnchecked(value, branch, p));
    const passingIndexes = results
      .map((branchErrors, index) => branchErrors.length === 0 ? index : -1)
      .filter((index) => index !== -1);

    if (passingIndexes.length !== 1) {
      errors.push(`${p}: must match exactly one schema in oneOf; matched ${passingIndexes.length}`);
      if (passingIndexes.length === 0 && value !== null && typeof value === "object" && !Array.isArray(value)) {
        const matchingDiscriminators = schema.oneOf
          .map((branch, index) => ({ discriminator: findDiscriminator(branch), index }))
          .filter(({ discriminator }) => discriminator && hasOwn(value, discriminator.key) && deepEqual(value[discriminator.key], discriminator.value));
        if (matchingDiscriminators.length === 1) {
          errors.push(...results[matchingDiscriminators[0].index]);
        }
      }
    }
  }

  if (hasOwn(schema, "const") && !deepEqual(value, schema.const)) {
    errors.push(`${p}: must equal ${safeQuote(schema.const)}, got ${safeQuote(value)}`);
  }
  if (hasOwn(schema, "enum") && !schema.enum.some((allowed) => deepEqual(value, allowed))) {
    const allowed = schema.enum.map(safeQuote).join(", ");
    errors.push(`${p}: invalid value ${safeQuote(value)} (expected one of ${allowed})`);
  }

  if (hasOwn(schema, "type") && typeOf(value) !== schema.type && !(schema.type === "integer" && typeOf(value) === "number" && Number.isInteger(value))) {
    errors.push(`${p}: expected ${schema.type}, got ${typeOf(value)}`);
    return;
  }

  if (typeOf(value) === "object") {
    for (const req of hasOwn(schema, "required") ? schema.required : []) {
      if (!hasOwn(value, req)) errors.push(`${p}: missing required field ${safeQuote(req)}`);
    }
    for (const key of Object.keys(value)) {
      if (hasOwn(schema, "properties") && hasOwn(schema.properties, key)) {
        validate(value[key], schema.properties[key], propertyPath(p, key), errors);
      } else if (hasOwn(schema, "additionalProperties") && schema.additionalProperties === false) {
        errors.push(`${p}: unexpected field ${safeQuote(key)}`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (hasOwn(schema, "maxItems") && value.length > schema.maxItems) {
      errors.push(`${p}: must have at most ${schema.maxItems} item(s), got ${value.length}`);
    }
    if (hasOwn(schema, "minItems") && value.length < schema.minItems) {
      errors.push(`${p}: must have at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (hasOwn(schema, "uniqueItems") && schema.uniqueItems === true) {
      const seen = new Set();
      let setBytes = 0;
      for (let i = 0; i < value.length; i++) {
        let canonical;
        try {
          canonical = canonicalKey(value[i]);
        } catch (error) {
          errors.push(`${p}[${i}]: ${error.message}`);
          break;
        }
        if (seen.has(canonical.key)) {
          errors.push(`${p}: items must be unique; duplicate at index ${i}`);
          continue;
        }
        setBytes += canonical.bytes;
        if (setBytes > LIMITS.uniqueSetBytes) {
          errors.push(`${p}: canonical uniqueness set exceeds ${LIMITS.uniqueSetBytes} byte limit`);
          break;
        }
        seen.add(canonical.key);
      }
    }
    if (hasOwn(schema, "items")) {
      value.forEach((item, index) => validate(item, schema.items, `${p}[${index}]`, errors));
    }
  }

  if (typeof value === "string") {
    if (hasOwn(schema, "minLength") && codePointLength(value) < schema.minLength) {
      errors.push(`${p}: must have at least ${schema.minLength} character(s)`);
    }
    if (schema.visibleContent === true) {
      if (!hasValidUnicodeScalarValues(value)) {
        errors.push(`${p}: must contain only valid Unicode scalar values`);
      } else if (!VISIBLE_CONTENT.test(value)) {
        errors.push(`${p}: must contain a visible character`);
      }
    }
    if (hasOwn(schema, "pattern") && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${p}: must match pattern ${JSON.stringify(schema.pattern)}`);
    }
  }

  if (typeof value === "number" && hasOwn(schema, "minimum") && value < schema.minimum) {
    errors.push(`${p}: must be at least ${schema.minimum}, got ${value}`);
  }
}

function collectUnchecked(value, schema, p) {
  const errors = createErrorList();
  validate(value, schema, p, errors);
  return errors;
}

function collect(value, schema, p = "$data") {
  const limitErrors = collectDataLimitErrors(value, p);
  if (limitErrors.length > 0) return limitErrors;
  return collectUnchecked(value, schema, p);
}

function isSafeRelativeSourcePath(value) {
  if (typeof value !== "string" || value.length === 0 || !hasValidUnicodeScalarValues(value) || value.trim() !== value || PATH_FORBIDDEN_CHARACTER.test(value) || value.includes("\\") || value.includes(":")) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith("~")) return false;
  const segments = value.split("/");
  return segments.every((segment) =>
    segment !== "" &&
    segment !== "." &&
    segment !== ".." &&
    !/[ .]$/u.test(segment) &&
    !WINDOWS_RESERVED_COMPONENT.test(segment));
}
function enforceJsonTextLimits(contents) {
  const containers = [];
  let inString = false;
  let escaped = false;

  function markArrayItem() {
    const container = containers[containers.length - 1];
    if (!container || container.type !== "array" || !container.expectsItem) return;
    container.expectsItem = false;
    container.items++;
    if (container.items > LIMITS.arrayItems) {
      throw new JsonStructureError(`input exceeds ${LIMITS.arrayItems} item array limit`);
    }
  }

  for (let index = 0; index < contents.length; index++) {
    const character = contents[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      markArrayItem();
      inString = true;
    } else if (character === "[" || character === "{") {
      markArrayItem();
      if (containers.length >= LIMITS.nestingDepth) {
        throw new JsonStructureError(`input exceeds ${LIMITS.nestingDepth} level nesting depth limit`);
      }
      containers.push({
        type: character === "[" ? "array" : "object",
        expectsItem: character === "[",
        items: 0,
      });
    } else if (character === "]" || character === "}") {
      containers.pop();
    } else if (character === ",") {
      const container = containers[containers.length - 1];
      if (container && container.type === "array") container.expectsItem = true;
    } else if (!/\s/.test(character)) {
      markArrayItem();
    }
  }
}

// Portable replacement for the upstream O_NOFOLLOW reader: refuse symlinks and non-regular
// files via lstat, then re-check the opened descriptor's identity and size.
function readFileWithinLimit(file) {
  let before;
  try {
    before = fs.lstatSync(file, { bigint: true });
  } catch {
    throw new SafeInputError("input could not be opened");
  }
  if (before.isSymbolicLink()) throw new SafeInputError("input must not be a symlink");
  if (!before.isFile()) throw new SafeInputError("input must be a regular file");
  if (before.size > BigInt(LIMITS.inputBytes)) throw new SafeInputError(`input exceeds ${LIMITS.inputBytes} byte limit`);
  const descriptor = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    const devMismatch = before.dev !== 0n && stat.dev !== 0n && stat.dev !== before.dev; // Windows lstat reports dev 0
    if (!stat.isFile() || stat.ino !== before.ino || devMismatch) {
      throw new SafeInputError("input changed while opening");
    }
    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytesRead = 0;
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      bytesRead += count;
      if (bytesRead > LIMITS.inputBytes) throw new SafeInputError(`input exceeds ${LIMITS.inputBytes} byte limit`);
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    try {
      return UTF8_DECODER.decode(Buffer.concat(chunks, bytesRead));
    } catch {
      throw new SafeInputError("input is not valid UTF-8");
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

// Read, size-check, structure-check, and parse a JSON file. Returns { value } or { error }.
function loadJsonFile(file, label) {
  let contents;
  try {
    contents = readFileWithinLimit(file);
  } catch (error) {
    return { error: `Failed to read ${label}: ${error instanceof SafeInputError ? error.message : "input could not be opened or read safely"}` };
  }
  try {
    enforceJsonTextLimits(contents);
  } catch (error) {
    return { error: `Failed to parse ${label}: ${error instanceof JsonStructureError ? error.message : "invalid JSON structure"}` };
  }
  try {
    return { value: JSON.parse(contents.replace(/^\uFEFF/, "")) };
  } catch {
    return { error: `Failed to parse ${label}: invalid JSON syntax` };
  }
}

function loadSchema(schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const errors = collectSchemaErrors(schema);
  if (errors.length > 0) throw new Error(`unsupported or invalid schema:\n${errors.join("\n")}`);
  return schema;
}

module.exports = {
  LIMITS,
  VISIBLE_CONTENT,
  createErrorList,
  escapeUnsafeDiagnosticCharacters,
  safeQuote,
  hasOwn,
  typeOf,
  hasVisibleProse,
  hasValidUnicodeScalarValues,
  collect,
  collectUnchecked,
  collectDataLimitErrors,
  collectSchemaErrors,
  isSafeRelativeSourcePath,
  loadJsonFile,
  loadSchema,
};
