import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import HomeClient from "./home-client";

export default async function HomePage() {
  const devModeEnabled =
    process.env.ENABLE_DEV_MODE === "true" && process.env.NODE_ENV !== "production";
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");

  if (!(devModeEnabled && isLocalhost)) {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) {
      redirect("/login");
    }
  }

  return <HomeClient devModeEnabled={devModeEnabled} />;
}
