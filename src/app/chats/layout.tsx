import { Suspense } from "react";
import { ChatsScreen } from "./ChatsScreen";

/**
 * One screen for /chats and /chats/[id], so the list keeps its place when a
 * chat opens (side by side on a computer, full screen on a phone).
 */
export default function ChatsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <ChatsScreen />
      </Suspense>
      {children}
    </>
  );
}
