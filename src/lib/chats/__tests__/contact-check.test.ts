import { describe, expect, it } from "vitest";
import { describeFound, findOffPlatformDetails } from "@/lib/chats/contact-check";

describe("findOffPlatformDetails", () => {
  it("finds Philippine mobile numbers written different ways", () => {
    for (const text of [
      "09171234567",
      "text mo ako 0917 123 4567 po",
      "0917-123-4567",
      "+639171234567",
      "+63 917 123 4567",
      "639171234567",
    ]) {
      expect(findOffPlatformDetails(text), text).toContain("a phone number");
    }
  });

  it("finds landlines with an area code", () => {
    expect(findOffPlatformDetails("call us (02) 8123 4567")).toContain("a phone number");
    expect(findOffPlatformDetails("032-234-5678")).toContain("a phone number");
  });

  it("finds links, bare domains and emails", () => {
    expect(findOffPlatformDetails("check https://kyna.shop/sale")).toContain("a link");
    expect(findOffPlatformDetails("www.kynaclothing.com")).toContain("a link");
    expect(findOffPlatformDetails("order sa kyna.ph po")).toContain("a link");
    expect(findOffPlatformDetails("m.me/kynaph")).toContain("a link");
    const email = findOffPlatformDetails("email kyna.shop@gmail.com");
    expect(email).toContain("an email");
    expect(email).not.toContain("a link");
  });

  it("finds payment and social app names in Taglish sentences", () => {
    expect(findOffPlatformDetails("Pwede po GCash na lang?")).toContain("GCash");
    expect(findOffPlatformDetails("send ko sa g-cash")).toContain("GCash");
    expect(findOffPlatformDetails("may PayMaya po kayo?")).toContain("Maya");
    expect(findOffPlatformDetails("PM mo ako sa messenger")).toContain("Messenger");
    expect(findOffPlatformDetails("add mo ko sa FB")).toContain("Facebook");
    expect(findOffPlatformDetails("viber or whatsapp")).toEqual(expect.arrayContaining(["Viber", "WhatsApp"]));
    expect(findOffPlatformDetails("follow us on IG")).toContain("Instagram");
    expect(findOffPlatformDetails("bank transfer BDO")).toContain("a bank");
    expect(findOffPlatformDetails("message us on Telegram")).toContain("Telegram");
  });

  it("leaves tracking numbers, order numbers, prices and sizes alone", () => {
    for (const text of [
      "Tracking nyo po: SPXPH0123456789",
      "JT0123456789 po yung tracking",
      "Order 250601ABCD1234 po",
      "TikTok order 577104219834661021",
      "₱199 lang po, free shipping over ₱500",
      "Size M po, waist 28-30, length 15 inches",
      "Dadating po bukas, 2-3 days",
      "Mamaya po namin i-ship",
      "Offbeat style po yan",
      "Salamat po sa order!",
      "",
    ]) {
      expect(findOffPlatformDetails(text), text).toEqual([]);
    }
  });
});

describe("describeFound", () => {
  it("joins reasons in plain English", () => {
    expect(describeFound(["a phone number"])).toBe("a phone number");
    expect(describeFound(["a phone number", "GCash"])).toBe("a phone number and GCash");
    expect(describeFound(["a link", "GCash", "Viber"])).toBe("a link, GCash and Viber");
  });
});
