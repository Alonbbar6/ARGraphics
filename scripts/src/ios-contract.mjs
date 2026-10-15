import { isDeepStrictEqual as equal } from "node:util";

const methods = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];
const annotations = ["description", "title", "example", "examples", "deprecated", "externalDocs"];
// Public model and thumbnail URLs returned by the iOS menu use this route,
// even though the spec groups it with owner drink operations.
const iosAssetPath = "/storage/public-objects/{filePath}";

function resolve(value, doc) {
  if (!value?.$ref) return value;
  if (!value.$ref.startsWith("#/")) throw new Error(`External reference not supported: ${value.$ref}`);
  const seen = new Set();
  while (value?.$ref) {
    const ref = value.$ref;
    if (seen.has(ref)) throw new Error(`Reference-only cycle: ${ref}`);
    seen.add(ref);
    const target = ref.slice(2).split("/").reduce(
      (node, key) => node?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], doc,
    );
    if (!target) throw new Error(`Unresolved reference: ${ref}`);
    const { $ref, ...siblings } = value;
    if (Object.keys(siblings).some((key) => !annotations.includes(key))) {
      throw new Error(`Structural $ref siblings need explicit support: ${ref}`);
    }
    value = target;
  }
  return value;
}

function rest(value, keys) {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([key]) =>
    ![...keys, ...annotations].includes(key)));
}

// Resolve refs even inside constructs we don't interpret (e.g. allOf). Equal
// ref names must not hide changes to the referenced component.
function expanded(value, doc, stack = new Set()) {
  if (!value || typeof value !== "object") return value;
  if (value.$ref) {
    if (stack.has(value.$ref)) return { recursiveRef: value.$ref };
    return expanded(resolve(value, doc), doc, new Set([...stack, value.$ref]));
  }
  if (Array.isArray(value)) return value.map((entry) => expanded(entry, doc, stack));
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, expanded(entry, doc, stack)]));
}

/** Conservative, directional compatibility for the public iOS wire contract.
 * Unknown changed schema/operation constructs fail closed, rather than guessing
 * about JSON Schema composition or silently ignoring a new validation keyword.
 */
export function compareIosContracts(base, proposed) {
  if (base.openapi !== "3.1.0" || proposed.openapi !== "3.1.0") {
    throw new Error("The iOS checker supports OpenAPI 3.1.0 only");
  }
  if (!base.paths || !proposed.paths) throw new Error("OpenAPI paths are required");
  const issues = new Set();
  const issue = (where, message) => issues.add(`${where}: ${message}`);
  const unchanged = (a, b, where, keys = []) => {
    if (!equal(expanded(rest(a, keys), base), expanded(rest(b, keys), proposed))) issue(where, "unsupported structural change (explicit checker support required)");
  };
  if (!equal(base.jsonSchemaDialect, proposed.jsonSchemaDialect)) issue("OpenAPI", "JSON Schema dialect changed");
  const visited = new WeakMap();
  function schema(a, b, where, direction) {
    a = resolve(a, base);
    b = resolve(b, proposed);
    if (a === undefined && b === undefined) return;
    if (a === undefined || b === undefined || typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
      if (!equal(a, b)) issue(where, "schema changed");
      return;
    }
    let pairs = visited.get(a);
    if (!pairs) visited.set(a, pairs = new WeakMap());
    let directions = pairs.get(b);
    if (!directions) pairs.set(b, directions = new Set());
    // Track only the active recursion stack, so shared refs still report each endpoint.
    if (directions.has(direction)) return;
    directions.add(direction);
    try {
      const types = (value) => [...(Array.isArray(value.type) ? value.type : [value.type])].sort();
      if (!equal(types(a), types(b))) issue(where, "type or nullability changed");
      if (!equal(a.format, b.format)) issue(where, "format changed");
      const oldEnum = a.enum;
      const newEnum = b.enum;
      if (!equal(oldEnum, newEnum)) {
        const accepted = direction === "request" ? newEnum : oldEnum;
        const emitted = direction === "request" ? oldEnum : newEnum;
        if (accepted && (!emitted || emitted.some((v) => !accepted.some((x) => equal(x, v))))) {
          issue(where, `${direction} enum is incompatible`);
        }
      }
      const oldRequired = a.required ?? [];
      const newRequired = b.required ?? [];
      const requiredBreaking = direction === "request"
        ? newRequired.filter((key) => !oldRequired.includes(key))
        : oldRequired.filter((key) => !newRequired.includes(key));
      for (const key of requiredBreaking) issue(`${where}.${key}`, direction === "request" ? "input became required" : "response no longer guaranteed");
      for (const [key, child] of Object.entries(a.properties ?? {})) {
        if (!Object.hasOwn(b.properties ?? {}, key)) issue(`${where}.${key}`, `${direction} field removed`);
        else schema(child, b.properties[key], `${where}.${key}`, direction);
      }
      if (a.items !== undefined || b.items !== undefined) schema(a.items, b.items, `${where}[]`, direction);
      const oldAdditional = a.additionalProperties ?? true;
      const newAdditional = b.additionalProperties ?? true;
      if (!equal(oldAdditional, newAdditional)) {
        if (direction === "request" && newAdditional === false && oldAdditional !== false) issue(where, "unknown inputs no longer accepted");
        else if (direction === "response" && oldAdditional === false && newAdditional !== false) issue(where, "response allows unknown fields");
        else if (typeof oldAdditional === "object" && typeof newAdditional === "object") schema(oldAdditional, newAdditional, `${where}.*`, direction);
        else if (direction === "request" ? oldAdditional !== false && newAdditional !== true : oldAdditional !== true && newAdditional !== false) issue(where, "additionalProperties changed incompatibly");
      }
      for (const key of ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties", "maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"]) {
        if (equal(a[key], b[key])) continue;
        const lower = key.startsWith("min") || key === "exclusiveMinimum";
        const oldLimit = a[key] ?? (lower ? -Infinity : Infinity);
        const newLimit = b[key] ?? (lower ? -Infinity : Infinity);
        const narrowed = lower ? newLimit > oldLimit : newLimit < oldLimit;
        if (direction === "request" ? narrowed : !narrowed) issue(where, `${key} changed incompatibly`);
      }
      unchanged(a, b, where, [
        "type", "format", "enum", "required", "properties", "items", "additionalProperties",
        "minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties",
        "maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties",
      ]);
    } finally {
      directions.delete(direction);
    }
  }
  function content(a = {}, b = {}, where, direction) {
    for (const [media, entry] of Object.entries(a)) {
      if (!b[media]) issue(`${where}.${media}`, "media type removed");
      else {
        schema(entry.schema, b[media].schema, `${where}.${media}`, direction);
        unchanged(entry, b[media], `${where}.${media}`, ["schema"]);
      }
    }
  }
  function parameters(pathItem, operation, doc) {
    const result = new Map();
    for (const raw of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
      const p = resolve(raw, doc);
      result.set(`${p.in}:${p.in === "header" ? p.name.toLowerCase() : p.name}`, p);
    }
    return result;
  }
  let count = 0;
  for (const [path, rawPath] of Object.entries(base.paths)) {
    const oldPath = resolve(rawPath, base);
    for (const method of methods) {
      const oldOp = oldPath[method];
      // Use the BASELINE scope: retagging or removing a path cannot evade checks.
      if (!oldOp || !(path.startsWith("/v1/") || oldOp.tags?.includes("ios") || path === iosAssetPath)) continue;
      count++;
      const where = `${method.toUpperCase()} ${path}`;
      const newPath = resolve(proposed.paths[path], proposed);
      const newOp = newPath?.[method];
      if (!newOp) { issue(where, "operation removed"); continue; }
      unchanged(oldPath, newPath, where, [...methods, "parameters", "summary"]);
      unchanged(oldOp, newOp, where, ["operationId", "tags", "summary", "parameters", "requestBody", "responses", "security", "servers"]);
      const oldSecurity = oldOp.security ?? base.security ?? [];
      const newSecurity = newOp.security ?? proposed.security ?? [];
      if (!equal(oldSecurity, newSecurity)) issue(where, "security requirements changed");
      for (const name of new Set(oldSecurity.flatMap((requirement) => Object.keys(requirement)))) {
        if (!equal(expanded(base.components?.securitySchemes?.[name], base), expanded(proposed.components?.securitySchemes?.[name], proposed))) issue(where, `security scheme ${name} changed`);
      }
      if (!equal(oldOp.servers ?? oldPath.servers ?? base.servers, newOp.servers ?? newPath.servers ?? proposed.servers)) issue(where, "server URL changed");
      const oldParams = parameters(oldPath, oldOp, base);
      const newParams = parameters(newPath, newOp, proposed);
      for (const [key, p] of newParams) {
        if (!oldParams.has(key) && p.required) issue(`${where}.${key}`, "new required input");
      }
      for (const [key, p] of oldParams) {
        const q = newParams.get(key);
        if (!q) { issue(`${where}.${key}`, "parameter removed"); continue; }
        if (!p.required && q.required) issue(`${where}.${key}`, "input became required");
        schema(p.schema, q.schema, `${where}.${key}`, "request");
        content(p.content, q.content, `${where}.${key}`, "request");
        unchanged(p, q, `${where}.${key}`, ["name", "required", "schema", "content"]);
      }
      const oldBody = resolve(oldOp.requestBody, base);
      const newBody = resolve(newOp.requestBody, proposed);
      if (!oldBody && newBody?.required) issue(where, "new required request body");
      if (oldBody && !newBody) issue(where, "request body removed");
      if (oldBody && newBody) {
        if (!oldBody.required && newBody.required) issue(where, "request body became required");
        content(oldBody.content, newBody.content, `${where}.body`, "request");
        unchanged(oldBody, newBody, `${where}.body`, ["required", "content"]);
      }
      for (const [status, raw] of Object.entries(oldOp.responses ?? {})) {
        const response = resolve(raw, base);
        const next = resolve(newOp.responses?.[status], proposed);
        if (!next) { issue(`${where}.${status}`, "response status removed"); continue; }
        content(response.content, next.content, `${where}.${status}`, "response");
        // Headers and links are conservative: don't silently overlook structural changes.
        unchanged(response, next, `${where}.${status}`, ["content"]);
      }
    }
  }
  if (!count) throw new Error("Baseline has no public iOS operations; refusing an empty check");
  return [...issues].sort();
}
