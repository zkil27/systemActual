import { NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { InvalidProofPhotoError, saveListingPhoto } from "@/lib/storage";

export const maxDuration = 30;

/** Uploads a product photo (JPEG/PNG/WebP, max 5 MB) for a new listing. */
export async function POST(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) {
      return NextResponse.json({ error: "Choose a photo first." }, { status: 400 });
    }
    const url = await saveListingPhoto(photo);
    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidProofPhotoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[listings/photos] upload", err);
    return NextResponse.json({ error: "Couldn't upload photo." }, { status: 500 });
  }
}
