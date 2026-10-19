import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { iosKey, signIn } from "./support/requests";
import { expectResponseContract } from "./support/response-contracts";

const visitor = "visitor-aaaa-bbbb-cccc-0101";
let ip = 0;

function guest(method: "get" | "post", path: string) {
  ip += 1;
  return request(app)[method](`/api/v1/${path}`)
    .set("x-api-key", iosKey).set("X-Forwarded-For", `198.51.100.${ip % 250}`);
}

async function liveOffer(cookie: string) {
  const display = await request(app).post("/api/displays").set("Cookie", cookie)
    .send({ type: "promo_offer", placement: "table", title: "Slow Wednesday", status: "live", offer: { title: "Free agua fresca" } })
    .expect(201);
  const codes = await request(app).post("/api/qr-codes").set("Cookie", cookie)
    .send({ labels: ["Table 4"], placement: "table", displayId: display.body.id }).expect(201);
  return { display: display.body as { id: string }, code: codes.body[0] as { id: string; code: string } };
}

/** The frozen test clock is 20:00 on Oct 13 in New York, inside the default 17:00 to 03:00 window. */
describe("live board", () => {
  it("reports tonight's window, last night's, and the newest events", async () => {
    const cookie = await signIn();
    const { display, code } = await liveOffer(cookie);
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const scan = (visitorHash: string, at: number, id = `scan-${visitorHash}-${at}`) => ({
      id, barId: "argraphics-demo-bar", qrCodeId: code.id, displayId: display.id, visitorHash, createdAt: new Date(at),
    });
    await db.insert(schema.scansTable).values([
      scan("a", now - 1 * hour), scan("a", now - 2 * hour), scan("b", now - 10 * 60 * 1000), // tonight
      scan("c", now - 22 * hour), scan("d", now - 23 * hour), // last night (opened yesterday 17:00, closed 03:00)
      scan("e", now - 30 * hour), // the afternoon before: in no window
    ]);
    await guest("post", `displays/${display.id}/claims`).send({ visitorId: visitor, code: code.code }).expect(201);

    const board = await request(app).get("/api/live").set("Cookie", cookie).expect(200);
    expectResponseContract("getLiveBoard", 200, board.body);
    expect(board.body).toMatchObject({ open: true, timezone: "America/New_York", serviceOpen: "17:00", serviceClose: "03:00" });
    expect(board.body.tonight).toMatchObject({ scans: 3, redemptions: 1, visitors: 2 });
    expect(board.body.tonight.byDisplay).toEqual([{ displayId: display.id, scans: 3, redemptions: 1 }]);
    expect(board.body.lastNight).toMatchObject({ scans: 2, redemptions: 0, visitors: 2 });
    expect(board.body.events[0]).toMatchObject({ kind: "redemption", displayId: display.id, spotLabel: "Table 4" });
    expect(board.body.events.map((event: { kind: string }) => event.kind)).toEqual(["redemption", "scan", "scan", "scan", "scan", "scan", "scan"]);
    expect(board.body.events[1]).toMatchObject({ kind: "scan", displayTitle: "Slow Wednesday", spotLabel: "Table 4" });

    const sinceIso = new Date(now - 90 * 60 * 1000).toISOString();
    const recent = await request(app).get(`/api/live?since=${encodeURIComponent(sinceIso)}`).set("Cookie", cookie).expect(200);
    expect(recent.body.events).toHaveLength(3);
    expect(recent.body.tonight.scans).toBe(3);

    await request(app).get("/api/live?since=yesterday").set("Cookie", cookie).expect(400);
    await request(app).get("/api/live").expect(401);
  });

  it("is closed outside service hours and keeps the last completed window", async () => {
    const cookie = await signIn();
    const profile = await request(app).patch("/api/partner/profile").set("Cookie", cookie)
      .send({ serviceOpen: "09:00", serviceClose: "15:00" }).expect(200);
    expectResponseContract("updatePartnerProfile", 200, profile.body);
    expect(profile.body).toMatchObject({ serviceOpen: "09:00", serviceClose: "15:00" });
    await request(app).patch("/api/partner/profile").set("Cookie", cookie).send({ serviceOpen: "9am" }).expect(400);

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    await db.insert(schema.scansTable).values([
      { id: "lunch-1", barId: "argraphics-demo-bar", qrCodeId: null, displayId: null, visitorHash: "lunch", createdAt: new Date(now - 8 * hour) }, // 12:00 today
    ]);
    const board = await request(app).get("/api/live").set("Cookie", cookie).expect(200);
    expectResponseContract("getLiveBoard", 200, board.body);
    expect(board.body.open).toBe(false);
    expect(board.body.tonight).toBeNull();
    expect(board.body.lastNight).toMatchObject({ scans: 1, redemptions: 0, visitors: 1, byDisplay: [] });
    expect(board.body.events[0]).toMatchObject({ kind: "scan", displayId: null, displayTitle: null, spotLabel: null });
  });
});
