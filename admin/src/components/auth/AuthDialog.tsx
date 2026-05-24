import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { resolveAdminAuth, setAdminKey } from "@/lib/api";

export function AuthDialog() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");

  useEffect(() => {
    const onAuth = () => setOpen(true);
    window.addEventListener("modelflux-admin-auth", onAuth);
    return () => window.removeEventListener("modelflux-admin-auth", onAuth);
  }, []);

  const submit = () => {
    const trimmed = key.trim();
    if (trimmed) setAdminKey(trimmed);
    resolveAdminAuth(trimmed || null);
    setOpen(false);
    setKey("");
  };

  const cancel = () => {
    resolveAdminAuth(null);
    setOpen(false);
    setKey("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) cancel();
        else setOpen(v);
      }}
      title="管理鉴权"
      description="请输入 ADMIN_AUTH_KEY。将保存到 localStorage 与 cookie modelflux_admin_key。"
    >
      <Input
        type="password"
        placeholder="ADMIN_AUTH_KEY"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        autoFocus
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={cancel}>
          取消
        </Button>
        <Button variant="primary" onClick={submit}>
          确认
        </Button>
      </div>
    </Dialog>
  );
}
