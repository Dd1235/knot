"use client";

import { useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import Button from "./Button";
import Icon from "./Icon";
import { LogOut } from "lucide-react";

/** Sign-out lives in the global header, so it can't stay welded to the chat
 * page's state the way it used to be. */
export default function SignOutButton() {
  const router = useRouter();

  const onSignOut = async () => {
    if (!window.confirm("Sign out? Your ledger and memory stay put.")) return;
    // Clear the local session pointer too, or the next sign-in resumes a
    // conversation that belongs to the previous account.
    localStorage.removeItem("ledger:session");
    await logout().catch(() => {});
    router.push("/login");
  };

  return (
    <Button onClick={onSignOut} aria-label="Sign out">
      <Icon as={LogOut} size={15} />
    </Button>
  );
}
