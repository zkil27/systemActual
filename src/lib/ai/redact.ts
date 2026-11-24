/**
 * Removes personal details from chat text before it goes to an AI service.
 * The reply doesn't need them: the order details come from Kyna Ops itself.
 */

const PHONE = /(?<![A-Za-z0-9])(?:\+?63|0)[\s.-]?9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?![A-Za-z0-9])/g;
const LANDLINE = /(?<![A-Za-z0-9])(?:\(0\d{1,3}\)|0\d{1,3})[\s-]\d{3,4}[\s-]?\d{4}(?![A-Za-z0-9])/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LINK = /(?:https?:\/\/|www\.)\S+/gi;
// Bank, card or e-wallet numbers. 17+ digits are TikTok order ids and stay.
const ACCOUNT = /(?<![A-Za-z0-9])\d(?:[\s-]?\d){9,15}(?![A-Za-z0-9])/g;
// A line that names a place and has a house or lot number in it.
const ADDRESS_WORDS =
  /\b(blk|block|lot|lt\.?|phase|purok|sitio|brgy\.?|barangay|bgy|street|st\.|avenue|ave\.?|road|rd\.|subd\.?|subdivision|village|vill\.?|zone|zip|unit|bldg|building|floor|city|province|municipality)\b/i;

function redactAddressLines(text: string): string {
  return text
    .split(/(?<=[\n.!?])/)
    .map((part) => (ADDRESS_WORDS.test(part) && /\d/.test(part) ? "[address] " : part))
    .join("")
    .replace(/\[address\]\s+/g, "[address] ")
    .trim();
}

export function redactPersonal(text: string): string {
  if (!text) return "";
  const out = text
    .replace(EMAIL, "[email]")
    .replace(LINK, "[link]")
    .replace(PHONE, "[phone]")
    .replace(LANDLINE, "[phone]")
    .replace(ACCOUNT, "[number]");
  return redactAddressLines(out);
}
