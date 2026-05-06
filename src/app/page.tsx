import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import HomeClient from "./home-client";

export default async function HomePage() {
  const devModeEnabled =
    process.env.ENABLE_DEV_MODE === "true" && process.env.NODE_ENV !== "production";
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  return <HomeClient devModeEnabled={devModeEnabled} />;
}
