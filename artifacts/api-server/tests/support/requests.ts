import request from "supertest";
import { app } from "./setup";
import { artworkPath, uploadArtwork } from "./storage";

export const iosKey = "ios-regression-fixture-key";
export const cardBody = { name: "Front table", objectPath: artworkPath, physicalWidthCm: 12.5 };

export async function signIn(email = "demo@garnish.app") {
  const response = await request(app).post("/api/auth/login")
    .send({ email, password: "fixture-password" }).expect(200);
  const cookies = response.headers["set-cookie"] as unknown as string[];
  return cookies[0].split(";")[0];
}

export async function createCard(cookie: string) {
  uploadArtwork();
  return request(app).post("/api/table-cards").set("Cookie", cookie)
    .send(cardBody).expect(201);
}

export function iosGet(path: string, ip = "192.0.2.1") {
  return request(app).get(`/api/v1/bars/${path}`)
    .set("x-api-key", iosKey).set("X-Forwarded-For", ip);
}
