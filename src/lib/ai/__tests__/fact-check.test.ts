import { describe, expect, it } from "vitest";
import { orderStatusLabel } from "@/lib/chats/order-panel";
import { buyerMeasurements, checkInTime, checkSize, checkStatus, parseSizeRange, sizesIn } from "../fact-check";
import { classifyIntents, needsOwner } from "../intent";

const RANGES = ["M (27-30)", "L (31-34)", "XL (35-38)", "2XL (39-42)"].map((s) => parseSizeRange(s)!);

describe("sizes", () => {
  it("reads size labels and ranges from listings", () => {
    expect(parseSizeRange("M (27-30)")).toEqual({ labels: ["M"], min: 27, max: 30 });
    expect(parseSizeRange("Medium 27-34")).toEqual({ labels: ["M"], min: 27, max: 34 });
    expect(parseSizeRange("2XL (39-42)")).toEqual({ labels: ["2XL"], min: 39, max: 42 });
    expect(parseSizeRange("One size")).toBeNull();
  });

  it("finds sizes in replies without catching Taglish words", () => {
    expect(sizesIn("L po ang swak, or Medium kung gusto ng fitted")).toEqual(["M", "L"]);
    expect(sizesIn("Salamat po sa pag-order")).toEqual([]);
    expect(sizesIn("2XL po")).toEqual(["2XL"]);
  });

  it("reads the buyer's waist and bust", () => {
    expect(buyerMeasurements("32 waist ko po")).toEqual([32]);
    expect(buyerMeasurements("31 waist, 38 bust")).toEqual([31, 38]);
    expect(buyerMeasurements("waist ko 28 po")).toEqual([28]);
    expect(buyerMeasurements("70kg po")).toEqual([]);
  });

  it("blocks a size that doesn't fit the buyer's waist", () => {
    expect(checkSize("Medium po ang swak sa inyo!", { buyerText: "32 waist ko, anong size?", ranges: RANGES })).toMatchObject({ ok: false });
    expect(checkSize("L (31-34) po ang swak sa 32 waist.", { buyerText: "32 waist ko, anong size?", ranges: RANGES })).toEqual({ ok: true });
    // Listing every size is fine when the right one is there.
    expect(checkSize("M is 27-30, L is 31-34, so L po.", { buyerText: "32 waist", ranges: RANGES })).toEqual({ ok: true });
  });

  it("blocks a size picked from weight alone, but allows asking for the waist", () => {
    expect(checkSize("L po para sa 70kg.", { buyerText: "70kg po Anu size", ranges: RANGES })).toMatchObject({ ok: false });
    expect(checkSize("Para po sigurado, ano po ang waist ninyo in inches? M (27-30), L (31-34).", { buyerText: "70kg po Anu size", ranges: RANGES })).toEqual({ ok: true });
  });
});

describe("order status", () => {
  it("allows a status the order really has", () => {
    expect(checkStatus("Na-ship na po, J&T tracking 7326.", "On the way")).toEqual({ ok: true });
    expect(checkStatus("Delivered na po ayon sa status.", "Delivered")).toEqual({ ok: true });
  });

  it("blocks a made-up status", () => {
    expect(checkStatus("Na-ship na po ang order ninyo!", "Getting ready to ship")).toMatchObject({ ok: false });
    expect(checkStatus("Your order has been delivered.", "On the way")).toMatchObject({ ok: false });
    expect(checkStatus("Na-ship na po ito.", null)).toMatchObject({ ok: false });
  });

  it("allows 'once it ships' and 'not yet shipped'", () => {
    expect(checkStatus("Kapag na-ship na po, makikita ang tracking.", "Getting ready to ship")).toEqual({ ok: true });
    expect(checkStatus("Hindi pa po naipadala na.", "Packed, waiting for courier")).toEqual({ ok: true });
  });

  it("knows what may be said for every status label the app shows", () => {
    const shipped = "Ang order ninyo ay on the way na po.";
    for (const s of ["IN_TRANSIT", "SHIPPED", "RETRY_SHIP", "PARTIALLY_SHIPPING", "DELIVERED", "TO_CONFIRM_RECEIVE", "COMPLETED", "TO_RETURN"]) {
      expect(checkStatus(shipped, orderStatusLabel(s)), s).toEqual({ ok: true });
    }
    for (const s of ["UNPAID", "READY_TO_SHIP", "PROCESSED", "AWAITING_SHIPMENT", "AWAITING_COLLECTION", "ON_HOLD", "CANCELLED", "IN_CANCEL"]) {
      expect(checkStatus(shipped, orderStatusLabel(s)), s).toMatchObject({ ok: false });
    }
  });
});

describe("deadlines", () => {
  it("blocks promises that the order arrives in time", () => {
    expect(checkInTime("Aabot po bago ang Friday!")).toMatchObject({ ok: false });
    expect(checkInTime("It will arrive in time for the party.")).toMatchObject({ ok: false });
    expect(checkInTime("Hindi po namin masisiguro kung aabot bago ang Friday.")).toEqual({ ok: true });
    expect(checkInTime("Iche-check po ng team kung aabot.")).toEqual({ ok: true });
    expect(checkInTime("Hindi po namin masisiguro na aabot ito bago ang Friday.")).toEqual({ ok: true });
  });
});

// Real buyer messages from stored chats (2026-11-24), without names.
describe("requests only a person can grant", () => {
  it("flags deadlines, photos, order changes, careful checks, reviews and going live", () => {
    for (const t of [
      "need ko yan agad for my tita bday this Friday",
      "sana po maship agad KC 25 po Ng 5pm byahe kmi pauwi bicol",
      "Paki picturan po kasi susuutin yan sa Christmas party",
      "pa change po ng large yun order ko,salamat",
      "Pwd palitan mo ng ibang kulay miron na pla ako ganitong kulay",
      "good pm po!!pki check po mabuti sana tamang size color at design Ang ipapaship nyo",
      "done with my 5star reviews",
      "pwedi q po ba live ang item nyo?",
    ]) {
      expect(needsOwner([t]), t).toBe(true);
    }
  });

  it("leaves ordinary questions alone", () => {
    for (const t of ["pwede po COD?", "kasya po ba sa 33 waistline?", "may plain black or red po ba nito", "print 17 available? medium size"]) {
      expect(needsOwner([t]), t).toBe(false);
    }
  });

  it("treats 'you sent the wrong size' as a complaint, not a size question", () => {
    expect(classifyIntents(["parang smaller size po un naipadala nyo, di po kasya sa thigh hole"])).toContain("returns");
    expect(classifyIntents(["Pwd palitan mo ng ibang kulay"])).toContain("returns");
    expect(classifyIntents(["kasya po ba sa 33 waistline?"])).toEqual(["size"]);
  });
});
