import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { expect } from "vitest";
import {
  CreateTableCardResponse, DeleteTableCardResponse, GetPublicMenuResponse,
  GetPublicMenuVersionResponse, GetPublicTableCardsResponse,
  ListTableCardsResponse, UpdateTableCardResponse,
} from "@workspace/api-zod";

const generated = {
  getPublicMenu: GetPublicMenuResponse,
  getPublicMenuVersion: GetPublicMenuVersionResponse,
  getPublicTableCards: GetPublicTableCardsResponse,
  listTableCards: ListTableCardsResponse,
  createTableCard: CreateTableCardResponse,
  updateTableCard: UpdateTableCardResponse,
  deleteTableCard: DeleteTableCardResponse,
};
type Operation = keyof typeof generated;
type ResponseSpec = { content?: { "application/json"?: { schema: object } } };
type OperationSpec = { operationId?: string; responses?: Record<string, ResponseSpec> };
const spec = parse(readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8",
)) as { components: object; paths: Record<string, Record<string, OperationSpec>> };

// Validate the wire JSON without coercion: generated date validators accept
// some non-string values and do not enforce every OpenAPI format.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

export function checkResponseContract(operation: Operation, status: number, body: unknown) {
  const key = `${operation}:${status}`;
  let validate = validators.get(key);
  if (!validate) {
    const definition = Object.values(spec.paths).flatMap(Object.values)
      .find((entry) => entry.operationId === operation);
    const responseSchema = definition?.responses?.[status]?.content?.["application/json"]?.schema;
    if (!responseSchema) throw new Error(`No documented JSON response for ${key}`);
    validate = ajv.compile({ ...responseSchema, components: spec.components });
    validators.set(key, validate);
  }
  const conforms = validate(body);
  const parsed = generated[operation].safeParse(body);
  return {
    conforms,
    errors: ajv.errorsText(validate.errors),
    generatedSuccess: parsed.success,
    generatedError: parsed.success ? "" : parsed.error.message,
  };
}

export function expectResponseContract(operation: Operation, status: number, body: unknown) {
  const result = checkResponseContract(operation, status, body);
  expect(result.conforms, `${operation} OpenAPI: ${result.errors}`).toBe(true);
  expect(result.generatedSuccess, `${operation} generated: ${result.generatedError}`).toBe(true);
}
