import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  // Shares lib/auth.ts with the server components, so "who am I" is defined
  // once. Previously this route rebuilt the same object by hand, which meant two
  // copies of the client/canEdit rules that had to be kept in step.
  return NextResponse.json({ user: await getCurrentUser() });
}
